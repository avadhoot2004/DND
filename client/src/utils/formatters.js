/**
 * Formats an integer amount in Paise to Indian Rupee (INR) currency string
 * e.g., 12000 -> "₹120" or 12050 -> "₹120.50"
 *
 * @param {number} paise - Amount in integer paise
 * @returns {string} Formatted INR currency string
 */
export function formatPaiseToRupees(paise) {
  if (typeof paise !== 'number' || isNaN(paise)) {
    return '₹0';
  }

  const rupees = paise / 100;

  // If whole rupee, omit decimal places
  const hasDecimals = rupees % 1 !== 0;

  return rupees.toLocaleString('en-IN', {
    style: 'currency',
    currency: 'INR',
    minimumFractionDigits: hasDecimals ? 2 : 0,
    maximumFractionDigits: 2
  });
}
