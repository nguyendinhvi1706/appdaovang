const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function getToken() {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('token');
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = { ...(options.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (!(options.body instanceof FormData)) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API}/api${path}`, { ...options, headers });
  if (res.status === 401 && typeof window !== 'undefined') {
    localStorage.removeItem('token');
    window.location.href = '/login';
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message ?? `Lỗi ${res.status}`);
  }
  return res.json();
}

export function logout() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.location.href = '/login';
}

/** Link file: đường dẫn nội bộ (/uploads/...) thì ghép với API, còn link tuyệt đối (VD file trên
 *  GitHub) thì giữ nguyên. Cần thiết vì đĩa của Render free tier là tạm — file upload sẽ MẤT mỗi
 *  lần deploy lại, nên các sản phẩm mẫu trỏ thẳng vào GitHub cho bền. */
export const uploadsUrl = (path: string) =>
  /^https?:\/\//i.test(path) ? path : `${API}${path}`;
