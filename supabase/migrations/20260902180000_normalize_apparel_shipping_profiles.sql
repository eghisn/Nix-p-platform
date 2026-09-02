-- Normalize legacy apparel profiles to the packing rules confirmed by NIXP.
-- Existing weight and folded dimensions are deliberately retained.
with shipping_groups(sku, packaging_group, package_type, shipping_class, status, source) as (
  values
    ('NXP-2023-APP-0001', 'SOFT_APPAREL', 'zip-lock-polybag-shipping-wrap', 'apparel-soft-zip-lock-wrap', 'format_reference', 'NIXP packing standard: zip-lock plastic plus protective shipping wrap'),
    ('NXP-2026-APP-0002', 'SOFT_APPAREL', 'zip-lock-polybag-shipping-wrap', 'apparel-soft-zip-lock-wrap', 'format_reference', 'NIXP packing standard: zip-lock plastic plus protective shipping wrap'),
    ('NXP-2026-APP-0003', 'SOFT_APPAREL', 'zip-lock-polybag-shipping-wrap', 'apparel-soft-zip-lock-wrap', 'format_reference', 'NIXP packing standard: zip-lock plastic plus protective shipping wrap'),
    ('NXP-2026-APP-0004', 'SOFT_APPAREL', 'zip-lock-polybag-shipping-wrap', 'apparel-soft-zip-lock-wrap', 'format_reference', 'NIXP packing standard: zip-lock plastic plus protective shipping wrap'),
    ('NXP-2026-APP-0006', 'SOFT_APPAREL', 'zip-lock-polybag-shipping-wrap', 'apparel-soft-zip-lock-wrap', 'format_reference', 'NIXP packing standard: zip-lock plastic plus protective shipping wrap'),
    ('NXP-2026-APP-0007', 'SOFT_APPAREL', 'zip-lock-polybag-shipping-wrap', 'apparel-soft-zip-lock-wrap', 'format_reference', 'NIXP packing standard: zip-lock plastic plus protective shipping wrap'),
    ('NXP-2026-APP-0009', 'CAP_HARDBOX', 'cap-hardbox-20x20x8', 'apparel-cap-hardbox', 'format_reference', 'NIXP packing standard: cap hardbox 20 x 20 x 8 cm'),
    ('NXP-2026-APP-0010', 'CAP_HARDBOX', 'cap-hardbox-20x20x8', 'apparel-cap-hardbox', 'format_reference', 'NIXP packing standard: cap hardbox 20 x 20 x 8 cm'),
    ('NXP-2026-APP-0011', 'SOFT_APPAREL', 'zip-lock-polybag-shipping-wrap', 'apparel-soft-zip-lock-wrap', 'format_reference', 'NIXP packing standard: Mood Valiant measured as T-shirt; zip-lock plastic plus protective shipping wrap')
)
update public.products as product
set raw = jsonb_set(
  coalesce(product.raw, '{}'::jsonb),
  '{shipping}',
  coalesce(product.raw->'shipping', '{}'::jsonb) || jsonb_build_object(
    'packagingGroup', groups.packaging_group,
    'packageType', groups.package_type,
    'shippingClass', groups.shipping_class,
    'status', groups.status,
    'source', groups.source,
    'updatedAt', '2026-09-02'
  ),
  true
),
updated_at = now()
from shipping_groups as groups
where product.sku = groups.sku;

-- Preform has supplied physical measurements but no reusable category rule.
-- Keep it server-only as a measured manual parcel instead of guessing a class.
update public.products as product
set raw = jsonb_set(
  coalesce(product.raw, '{}'::jsonb),
  '{shipping}',
  coalesce(product.raw->'shipping', '{}'::jsonb) || jsonb_build_object(
    'packagingGroup', 'MANUAL_OVERRIDE',
    'manualShippingOverride', true,
    'status', 'measured_manual',
    'source', 'NIXP packing standard: measured object in cardboard and bubble wrap',
    'updatedAt', '2026-09-02'
  ),
  true
),
updated_at = now()
where product.sku = 'NXP-2026-OBJ-0002';
