import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reportPeriod } from '../supabase/functions/send-report/report-period.js';
test('daily includes previous full IST day across year boundary', () => {
 assert.deepEqual(reportPeriod('daily',new Date('2026-12-31T18:45:00Z')), {dateFrom:'2026-12-31',dateTo:'2026-12-31',todayIST:'2027-01-01'});
});
test('weekly covers all seven completed days including Sunday', () => {
 assert.deepEqual(reportPeriod('weekly',new Date('2026-10-04T02:30:00Z')), {dateFrom:'2026-09-27',dateTo:'2026-10-03',todayIST:'2026-10-04'});
});
test('invalid report type rejected', () => assert.throws(() => reportPeriod('monthly')));
