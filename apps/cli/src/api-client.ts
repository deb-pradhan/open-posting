// ============================================================================
// Open Posting — CLI API Client
// ============================================================================

import type { ApiResult } from '@open-posting/shared';

const API_URL = process.env['OPEN_POSTING_URL'] ?? 'http://localhost:3000';
const API_KEY = process.env['OPEN_POSTING_API_KEY'] ?? '';

export async function apiCall<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = await res.json() as ApiResult<T>;

  if (!data.ok) {
    const error = (data as { error: { code: string; message: string } }).error;
    throw new Error(`[${error.code}] ${error.message}`);
  }

  return (data as { data: T }).data;
}

export function isJsonOutput(): boolean {
  return !process.stdout.isTTY || process.argv.includes('--json');
}
