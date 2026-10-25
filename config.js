// Публічні налаштування. anon-ключ Supabase призначений для браузера: дані захищені правилами RLS і входом.
// Секретний service_role-ключ ніколи не вставляється сюди (він лише в .env.local, який не потрапляє в git).
export const CONFIG = {
  SUPABASE_URL: "https://kzoqpwlutdwzuulmgusd.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt6b3Fwd2x1dGR3enV1bG1ndXNkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NTYxODAsImV4cCI6MjEwODUzMjE4MH0.RoTAk8XwdlLcaMUuM87pg0JC3TRWUdJ__UYBZZ6y25Y",
  // Єдиний акаунт власника. Лист на цю адресу не надсилається, потрібен лише як ім'я для входу паролем.
  OWNER_EMAIL: "owner@mlcards.app",
};
