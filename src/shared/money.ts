/**
 * Formats integer minor units for display, e.g. formatMinor(25000, 'EUR') === '€250.00'.
 * The decimal string is built exactly (no float division) and the minor-unit exponent comes from Intl
 * (2 for USD and EUR).
 */
export function formatMinor(minor: number, currency: string): string {
  const fmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  });
  const exponent = fmt.resolvedOptions().maximumFractionDigits ?? 2;
  const digits = Math.abs(minor)
    .toString()
    .padStart(exponent + 1, '0');
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  const decimal = `${minor < 0 ? '-' : ''}${whole}${exponent > 0 ? `.${fraction}` : ''}`;

  return fmt.format(decimal as Intl.StringNumericLiteral);
}
