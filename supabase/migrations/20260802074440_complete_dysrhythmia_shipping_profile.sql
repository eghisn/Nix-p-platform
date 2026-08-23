update public.products
set raw = jsonb_set(
      coalesce(raw, '{}'::jsonb),
      '{shipping}',
      jsonb_build_object(
        'weightGrams', 200,
        'lengthCm', 18,
        'widthCm', 16,
        'heightCm', 6,
        'shippingClass', 'cd-cardboard-bubble',
        'packageType', 'bubble-wrap-corrugated-small-media-box',
        'packagingGroup', 'SMALL_MEDIA',
        'manualShippingOverride', false,
        'status', 'format_reference',
        'source', 'NIXP SMALL_MEDIA packing rule v1',
        'updatedAt', current_date
      ),
      true
    ),
    synced_at = now()
where sku = 'NXP-2026-CD-0036'
  and (raw->'shipping' is null or jsonb_typeof(raw->'shipping') <> 'object');
