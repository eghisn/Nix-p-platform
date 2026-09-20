-- Keep test checkout activity auditable without mixing it into customer sales,
-- Finance P&L, stock reporting, or marketing conversion metrics.

alter table public.order_records
  add column if not exists order_class text not null default 'Customer';

alter table public.order_records
  drop constraint if exists order_records_order_class_check;

alter table public.order_records
  add constraint order_records_order_class_check
  check (order_class in ('Customer', 'Test')) not valid;

alter table public.order_records
  validate constraint order_records_order_class_check;

create index if not exists order_records_order_class_created_at_idx
  on public.order_records (order_class, created_at desc);

create or replace function public.classify_checkout_order_record()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Checkout writes its order lines before the deferred parent row. Looking up
  -- the lines here guarantees a test SKU is classified before it is persisted.
  if exists (
    select 1
    from public.order_lines
    where order_id = new.id
      and sku ~* '^NXP-TEST-'
  ) then
    new.order_class := 'Test';
    new.metadata := coalesce(new.metadata, '{}'::jsonb) || jsonb_build_object(
      'orderClassificationReason', 'System test SKU'
    );
  end if;
  return new;
end;
$$;

drop trigger if exists classify_checkout_order_record on public.order_records;
create trigger classify_checkout_order_record
before insert or update of id, order_class, metadata on public.order_records
for each row execute function public.classify_checkout_order_record();

revoke all on function public.classify_checkout_order_record() from public, anon, authenticated;

update public.order_records as order_record
set order_class = 'Test',
    metadata = coalesce(order_record.metadata, '{}'::jsonb) || jsonb_build_object(
      'orderClassificationReason', 'System test SKU'
    ),
    updated_at = now()
where order_record.order_class <> 'Test'
  and exists (
    select 1
    from public.order_lines as order_line
    where order_line.order_id = order_record.id
      and order_line.sku ~* '^NXP-TEST-'
  );

create or replace function public.normalize_finance_sales_payload(p_payload jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  select coalesce(jsonb_agg(
    entry.value || jsonb_build_object(
      'orderClass', case
        when lower(coalesce(entry.value->>'orderClass', entry.value->>'order_class', '')) = 'test'
          or coalesce(entry.value->>'sku', '') ~* '(^|[, /])NXP-TEST-' then 'Test'
        else 'Customer'
      end,
      'salesChannel', case
        when coalesce(entry.value->>'salesChannel', entry.value->>'sales_channel', '') in ('Website', 'Instagram', 'WhatsApp', 'Marketplace', 'Offline', 'Other')
          then coalesce(entry.value->>'salesChannel', entry.value->>'sales_channel')
        when lower(coalesce(entry.value->>'invoice', '')) like 'order-%' then 'Website'
        else 'Other'
      end
    )
    order by entry.ordinality
  ), '[]'::jsonb)
  from jsonb_array_elements(
    case when jsonb_typeof(p_payload) = 'array' then p_payload else '[]'::jsonb end
  ) with ordinality as entry(value, ordinality);
$$;

create or replace function public.normalize_finance_state_sales()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.state := jsonb_set(
    coalesce(new.state, '{}'::jsonb),
    '{sales}',
    public.normalize_finance_sales_payload(new.state->'sales'),
    true
  );
  return new;
end;
$$;

drop trigger if exists normalize_finance_state_sales on public.finance_state;
create trigger normalize_finance_state_sales
before insert or update of state on public.finance_state
for each row execute function public.normalize_finance_state_sales();

create or replace function public.normalize_finance_sales_section()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.section = 'sales' then
    new.payload := public.normalize_finance_sales_payload(new.payload);
  end if;
  return new;
end;
$$;

drop trigger if exists normalize_finance_sales_section on public.finance_state_sections;
create trigger normalize_finance_sales_section
before insert or update of payload on public.finance_state_sections
for each row execute function public.normalize_finance_sales_section();

revoke all on function public.normalize_finance_sales_payload(jsonb) from public, anon, authenticated;
revoke all on function public.normalize_finance_state_sales() from public, anon, authenticated;
revoke all on function public.normalize_finance_sales_section() from public, anon, authenticated;

-- Re-save the canonical state once. The existing mirror trigger propagates the
-- normalized sales payload to independently-versioned Finance sections.
update public.finance_state
set state = state
where key = 'main';

-- Marketing rollups must only describe customer commerce. Keep the existing
-- function implementations intact and add the same classification predicate to
-- every order-backed aggregate. The checks fail closed if the prior function
-- definitions unexpectedly differ from the version this migration upgrades.
do $rollups$
declare
  v_function text;
begin
  select pg_get_functiondef('public.refresh_marketing_rollups(date,date)'::regprocedure) into v_function;
  if position('coalesce(order_record.order_class, ''Customer'') <> ''Test''' in v_function) = 0 then
    if position($paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))$paid$ in v_function) = 0 then
      raise exception 'Unexpected refresh_marketing_rollups definition.';
    end if;
    v_function := replace(v_function,
      $paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))$paid$,
      $customer_paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))
      and coalesce(order_record.order_class, 'Customer') <> 'Test'$customer_paid$
    );
    v_function := replace(v_function,
      $refund$    where coalesce(nullif(metadata->>'refundVerifiedAt', '')::timestamptz, updated_at, created_at) >= v_event_from$refund$,
      $customer_refund$    where coalesce(nullif(metadata->>'refundVerifiedAt', '')::timestamptz, updated_at, created_at) >= v_event_from
      and coalesce(order_class, 'Customer') <> 'Test'$customer_refund$
    );
    v_function := replace(v_function,
      $outcome$    where coalesce(updated_at, created_at) >= v_event_from and coalesce(updated_at, created_at) < v_event_to$outcome$,
      $customer_outcome$    where coalesce(updated_at, created_at) >= v_event_from and coalesce(updated_at, created_at) < v_event_to
      and coalesce(order_class, 'Customer') <> 'Test'$customer_outcome$
    );
    v_function := replace(v_function,
      $customers$  where nullif(btrim(customer->>'email'), '') is not null$customers$,
      $customer_rows$  where nullif(btrim(customer->>'email'), '') is not null
    and coalesce(order_class, 'Customer') <> 'Test'$customer_rows$
    );
    execute v_function;
  end if;
end;
$rollups$;

do $attribution$
declare
  v_function text;
begin
  select pg_get_functiondef('public.marketing_dashboard_session_summary(date,date)'::regprocedure) into v_function;
  if position('coalesce(order_record.order_class, ''Customer'') <> ''Test''' in v_function) = 0 then
    if position($paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))$paid$ in v_function) = 0 then
      raise exception 'Unexpected marketing_dashboard_session_summary definition.';
    end if;
    v_function := replace(v_function,
      $paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))$paid$,
      $customer_paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))
      and coalesce(order_record.order_class, 'Customer') <> 'Test'$customer_paid$
    );
    execute v_function;
  end if;

  select pg_get_functiondef('public.marketing_dashboard_monthly_report(date)'::regprocedure) into v_function;
  if position('coalesce(order_record.order_class, ''Customer'') <> ''Test''' in v_function) = 0 then
    if position($paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))$paid$ in v_function) = 0 then
      raise exception 'Unexpected marketing_dashboard_monthly_report definition.';
    end if;
    v_function := replace(v_function,
      $paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))$paid$,
      $customer_paid$      and (order_record.paid_at is not null or lower(coalesce(order_record.payment_status, '')) in ('paid', 'settlement', 'capture', 'completed'))
      and coalesce(order_record.order_class, 'Customer') <> 'Test'$customer_paid$
    );
    execute v_function;
  end if;
end;
$attribution$;

select public.refresh_marketing_rollups(
  ((now() at time zone 'Asia/Jakarta')::date - 400),
  (now() at time zone 'Asia/Jakarta')::date
);
