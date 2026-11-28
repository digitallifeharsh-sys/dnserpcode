export class InputError extends Error {
  constructor(message, status = 400) { super(message); this.name = "InputError"; this.status = status; }
}
export const positiveId = (value, name = "ID") => {
  if (!/^\d+$/.test(String(value ?? "")) || Number(value) <= 0 || !Number.isSafeInteger(Number(value)))
    throw new InputError(`Invalid ${name}.`);
  return Number(value);
};
export const amountInCents = (value, { allowZero = false, name = "Amount" } = {}) => {
  if (typeof value === "boolean" || value === null || value === undefined || !/^(?:\d+)(?:\.\d{1,2})?$/.test(String(value).trim()))
    throw new InputError(`${name} must be a valid amount with at most 2 decimal places.`);
  const amount = Number(value);
  const cents = Math.round(amount * 100);
  if (!Number.isSafeInteger(cents) || cents > 9999999999 || (allowZero ? cents < 0 : cents <= 0))
    throw new InputError(`${name} must be ${allowZero ? 'non-negative' : 'greater than zero'} and within the supported range.`);
  return cents;
};
export const validDate = (value, name = "Date") => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new InputError(`Invalid ${name}.`);
  const [year, month, day] = value.split("-").map(Number);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day)
    throw new InputError(`Invalid ${name}.`);
  return value;
};
export const validMode = (value) => {
  const mode = value || "Cash";
  if (!["Cash", "UPI", "Bank", "Card", "Other"].includes(mode)) throw new InputError("Invalid payment mode.");
  return mode;
};
export const limitedText = (value, max, name) => {
  if (value == null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > max) throw new InputError(`${name} is too long or invalid.`);
  return value.trim() || null;
};
export const cents = (value) => Math.round(Number(value || 0) * 100);
export const rupees = (integerCents) => (integerCents / 100).toFixed(2);
