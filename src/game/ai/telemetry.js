const telemetry = []

export function recordTelemetry(entry) {
  telemetry.unshift({ ...entry, recordedAt: Date.now() })
  if (telemetry.length > 50) telemetry.length = 50
  return entry
}

export function getTelemetry() {
  return [...telemetry]
}

export function clearTelemetry() {
  telemetry.length = 0
}
