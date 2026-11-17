import { ApiError } from './api/client';
import type { Lang } from './i18n';

// Envelope codes, the client-only network_error, the conflict sub-case stale_order,
// and the per-field codes the backend sends in `fields`.
const TEXT: Record<Lang, Record<string, string>> = {
  th: {
    bad_request: 'คำขอไม่ถูกต้อง',
    unauthorized: 'กรุณาเข้าสู่ระบบใหม่',
    forbidden: 'คุณไม่มีสิทธิ์ทำรายการนี้',
    not_found: 'ไม่พบข้อมูลที่ต้องการ',
    conflict: 'ข้อมูลขัดแย้งกับสถานะปัจจุบัน',
    stale_order: 'ข้อมูลถูกแก้ไขโดยผู้อื่น กำลังโหลดใหม่',
    validation_failed: 'ข้อมูลไม่ถูกต้อง',
    server_error: 'เกิดข้อผิดพลาดที่เซิร์ฟเวอร์ ลองอีกครั้ง',
    network_error: 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้',
    required: 'จำเป็นต้องกรอก',
    too_long: 'ยาวเกินกำหนด',
    invalid: 'ค่าไม่ถูกต้อง',
    invalid_date: 'รูปแบบวันที่ไม่ถูกต้อง',
    before_start: 'ต้องไม่ก่อนวันเริ่มต้น',
    not_member: 'ผู้ใช้ไม่ได้เป็นสมาชิกโปรเจกต์',
  },
  en: {
    bad_request: 'Invalid request',
    unauthorized: 'Please sign in again',
    forbidden: 'You do not have permission to do this',
    not_found: 'Not found',
    conflict: 'This conflicts with the current state',
    stale_order: 'Someone else changed this. Reloading',
    validation_failed: 'Some values are invalid',
    server_error: 'Server error. Please try again',
    network_error: 'Cannot reach the server',
    required: 'Required',
    too_long: 'Too long',
    invalid: 'Invalid value',
    invalid_date: 'Invalid date',
    before_start: 'Must not be before the start date',
    not_member: 'User is not a project member',
  },
};

/** Text for an envelope code, field code, network_error or stale_order. Unknown codes fall back to server_error. */
export function errorText(code: string, lang: Lang): string {
  return TEXT[lang][code] ?? TEXT[lang].server_error;
}

/** conflict + error "stale_order" is its own case (the client refetches the board); everything else keys on code. */
export function errorKey(e: unknown): string {
  if (!(e instanceof ApiError)) return 'server_error';
  return e.code === 'conflict' && e.message === 'stale_order' ? 'stale_order' : e.code;
}

export function errorMessage(e: unknown, lang: Lang): string {
  return errorText(errorKey(e), lang);
}
