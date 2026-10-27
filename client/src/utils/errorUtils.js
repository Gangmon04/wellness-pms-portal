/**
 * Error normalization utility following WidgetRepo standard (zohoWriteErrorReason).
 * Translates raw database/API errors into user-friendly clinical messages.
 */

export function formatPmsErrorMessage(rawError) {
  if (!rawError) {
    return 'Unable to confirm your appointment at this time. Please try again.';
  }

  const str = (typeof rawError === 'object' ? (rawError.message || rawError.error || JSON.stringify(rawError)) : String(rawError)).trim();
  const lower = str.toLowerCase();

  // 1. Business hours violation
  if (lower.includes('business hours') || lower.includes('operating hours') || lower.includes('falls under business')) {
    return 'The selected appointment time is outside the clinic’s operating hours. Please select another slot.';
  }

  // 2. Doctor / Department member mismatch
  if (lower.includes('service members') || lower.includes('part of service') || lower.includes('dependent_mismatch')) {
    return 'The selected doctor is not assigned to this department. Please choose another practitioner or service.';
  }

  // 3. Slot already taken / duplicate
  if (lower.includes('duplicate') || lower.includes('already booked') || lower.includes('slot taken')) {
    return 'This appointment slot is no longer available. Please select another time.';
  }

  // 4. Missing required details
  if (lower.includes('mandatory') || lower.includes('required field') || lower.includes('missing')) {
    return 'Please ensure all required appointment details are completed before booking.';
  }

  // 5. Generic 'invalid data' (CRM validation error)
  if (lower === 'invalid data' || lower.includes('invalid_data') || lower.includes('invalid data')) {
    return 'Could not process the appointment with the provided details. Please verify your information or choose another slot.';
  }

  // 6. Network / connection issues
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('timeout')) {
    return 'Connection to clinical services timed out. Please check your internet and try again.';
  }

  // 7. Fallback to clean string if already readable
  if (str.length > 5 && !str.includes('{') && !str.includes('_s')) {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  return 'Unable to confirm your appointment right now. Please choose another slot or try again.';
}
