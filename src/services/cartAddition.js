export function commitCartAddition({ product, key, stock, cart, clearCheckoutSession, persistCart }) {
  const price = Number(product?.price);
  if (
    !product?.id || product.publishStatus !== "Published" || product.visibility !== "Public" ||
    product.open_to_offers === true || !Number.isSafeInteger(price) || price <= 0 ||
    !key || !Number.isInteger(stock) || stock <= 0 ||
    cart.filter((itemKey) => itemKey === key).length >= stock
  ) return null;

  const nextCart = [...cart, key];
  try {
    clearCheckoutSession();
    persistCart(nextCart);
  } catch {
    return null;
  }
  return nextCart;
}
