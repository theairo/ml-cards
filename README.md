# ML Cards

Картки з машинного навчання з інтервальним повторенням. Застосунок статичний (HTML і JavaScript), дані й вхід у Supabase, хостинг GitHub Pages. Тексти карток лежать у базі за паролем, у цьому репозиторії лише код.

## Як це влаштовано

- `index.html`, `style.css`, `js/` це застосунок. `config.js` містить публічну адресу й anon-ключ Supabase.
- Вхід: одна фіксована пошта власника (`OWNER_EMAIL` у `config.js`) і пароль, який вводиться на сторінці. Сесія запам'ятовується в браузері. Доступ до таблиць мають лише авторизовані (RLS).
- `supabase/schema.sql` це схема бази.
- `scripts/` це керування базою з терміналу ключем service_role з `.env.local`.

## Налаштування Supabase (один раз)

1. Створити проєкт на supabase.com.
2. SQL Editor, вставити вміст `supabase/schema.sql`, Run.
3. Authentication, Sign In / Providers, Email: вимкнути Confirm email. Там само вимкнути Allow new users to sign up.
4. Authentication, Users, Add user: пошта з `OWNER_EMAIL`, пароль на вибір, відмітити Auto Confirm User.
5. Project Settings, API: Project URL та anon (publishable) ключ вписати в `config.js`.
6. Скопіювати `.env.local.example` як `.env.local` і вставити SUPABASE_URL та service_role (або secret) ключ. Файл у git не потрапляє.

Зміни схеми для вже створеної бази лежать у `supabase/migrations/` (виконувати по порядку в SQL Editor). `002_daily_limit.sql` додає денний ліміт нових карток.

## Робота з картками

```bash
node scripts/extract-seed.mjs        # одноразово: витягти початкові картки зі старої сторінки у data/seed.json
node scripts/db.mjs seed             # завантажити їх у базу
node scripts/db.mjs inbox            # нерозподілені картки, додані в застосунку
node scripts/db.mjs assign <id> node=<тема> type=A2 depth=1 requires=<теми через кому> position=<n>
node scripts/db.mjs tree             # дерево тем і кількість карток
node scripts/db.mjs apply file.json  # додати вузли, картки, лаби (повні рядки)
```

## Локальна перевірка без бази

```bash
python -m http.server 8765
```

Відкрити `http://localhost:8765/?mock=1`, пароль `test`. Працює лише на localhost і лише якщо є `data/seed.json`.

## Правила карток

Див. `LAB_METHODOLOGY.md` у проєкті з лабами: типи A1-A9, глибина 1-3, порядок відкриття.
