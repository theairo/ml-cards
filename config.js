// Публічні налаштування. anon-ключ Supabase призначений для браузера: дані захищені правилами RLS і входом.
// Секретний service_role-ключ ніколи не вставляється сюди (він лише в .env.local, який не потрапляє в git).
export const CONFIG = {
  SUPABASE_URL: "https://YOUR-PROJECT.supabase.co",
  SUPABASE_ANON_KEY: "YOUR-ANON-KEY",
  // Єдиний акаунт власника. Лист на цю адресу не надсилається, потрібен лише як ім'я для входу паролем.
  OWNER_EMAIL: "owner@mlcards.app",
};
