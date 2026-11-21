export type AuditAction =
  | "USER_REGISTERED"
  | "LOGIN_SUCCEEDED"
  | "LOGIN_FAILED"
  | "LOGIN_LOCKED"
  | "LOGIN_REJECTED_INACTIVE_USER"
  | "SESSION_REFRESHED"
  | "SESSION_REFRESH_REJECTED"
  | "SESSION_LOGGED_OUT";

export interface AuditEvent {
  auditId: string;
  action: AuditAction;
  occurredAt: string;
  outcome: "SUCCESS" | "FAILURE";
  userId?: string;
  identifierHash?: string;
  sessionId?: string;
  reason?: string;
}

export interface AuditRepository {
  record(event: AuditEvent): Promise<void>;
}
