const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function getAnalysisDate(): Date {
  const configured = process.env.FINANCE_AS_OF_DATE?.trim()
  if (!configured) return new Date()
  if (!ISO_DATE.test(configured)) {
    throw new Error("FINANCE_AS_OF_DATE must use YYYY-MM-DD format")
  }
  const parsed = new Date(`${configured}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("FINANCE_AS_OF_DATE is not a valid date")
  }
  return parsed
}
