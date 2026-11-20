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
    last_pm: 'โปรเจกต์ต้องมี PM อย่างน้อยหนึ่งคน',
    already_member: 'ผู้ใช้เป็นสมาชิกโปรเจกต์อยู่แล้ว',
    name_in_use: 'มีโปรเจกต์ชื่อนี้อยู่แล้ว',
    label_name_in_use: 'มีป้ายกำกับชื่อนี้อยู่แล้ว',
    project_archived: 'โปรเจกต์นี้ถูกเก็บถาวรแล้ว จึงแก้ไขไม่ได้',
    too_large: 'ไฟล์ใหญ่เกิน 20 MB',
    not_pdf: 'รองรับเฉพาะไฟล์ PDF',
    unsupported_type: 'รองรับเฉพาะไฟล์ Word (.docx), Excel (.xlsx), PowerPoint (.pptx) และ PDF',
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
    last_pm: 'A project must keep at least one PM',
    already_member: 'This person is already a member',
    name_in_use: 'A project with this name already exists',
    label_name_in_use: 'A label with this name already exists',
    project_archived: 'This project is archived and cannot be changed',
    too_large: 'The file is larger than 20 MB',
    not_pdf: 'Only PDF files are supported',
    unsupported_type: 'Only Word (.docx), Excel (.xlsx), PowerPoint (.pptx) and PDF files are supported',
  },
};

/** Text for an envelope code, field code, network_error or stale_order. Unknown codes fall back to server_error. */
export function errorText(code: string, lang: Lang): string {
  return TEXT[lang][code] ?? TEXT[lang].server_error;
}

// Conflict sub-cases: the server puts a stable token in `error` (backend project.Conflict*, like stale_order).
const CONFLICTS: Record<string, string> = {
  stale_order: 'stale_order',
  last_pm: 'last_pm',
  already_member: 'already_member',
  name_in_use: 'name_in_use',
  label_name_in_use: 'label_name_in_use',
  // any write to an archived project (backend apperr.ConflictProjectArchived)
  project_archived: 'project_archived',
};

/** A conflict with a known message gets its own key (stale_order makes the client refetch); everything else keys on code. */
export function errorKey(e: unknown): string {
  if (!(e instanceof ApiError)) return 'server_error';
  return e.code === 'conflict' ? (CONFLICTS[e.message] ?? 'conflict') : e.code;
}

export function errorMessage(e: unknown, lang: Lang): string {
  return errorText(errorKey(e), lang);
}
