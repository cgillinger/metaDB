import { clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatDate(date) {
  const d = new Date(date)
  return d.toLocaleDateString('sv-SE', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

export function formatNumber(number) {
  return new Intl.NumberFormat('sv-SE').format(number)
}

export function isValidCSVFile(file) {
  return file && (
    file.type === 'text/csv' ||
    file.name.toLowerCase().endsWith('.csv')
  )
}

export function generateId() {
  return Math.random().toString(36).substring(2) + Date.now().toString(36)
}
