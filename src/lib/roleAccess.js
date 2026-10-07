export const canWrite = role => ['owner','staff','super-admin'].includes(role);
export const canManage = role => ['owner','super-admin'].includes(role);
export const visibleTransactions = (rows, role, now) => canManage(role) ? rows : rows.filter(t => !t.deleted_at && t.createdAt >= now - 86400000);
