# web-cheat-terminal

نسخه وب cheat-terminal — چیت‌شیت‌هات رو از مرورگر بگرد، بدون نصب هیچی. همون ۱۳۹۲ دستور نسخه ترمینال (لینوکس، پاورشل، داکر، گیت) با جست‌وجوی زنده، دسته‌بندی، فیلتر کاربردی بودن و کپی با یه کلیک.

**سایت زنده:** https://web-cheat-terminal.terminal88project.workers.dev

- **۱۳۹۲ دستور** از روز اول: لینوکس ۵۱۳، پاورشل ۳۹۸، گیت ۲۶۷، داکر ۲۱۴
- **جست‌وجوی زنده** موقع تایپ — توی عنوان، دستور، توضیح و تگ‌ها
- **مرورگر کامل**: سایدبار دسته‌ها با تعداد، لیست نتایج، پنل جزئیات با توضیح کامل
- **کپی** هر دستور با یه کلیک
- **فیلتر کاربردی بودن**: Essential ،Common یا Advanced — هر دستور یه درجه داره
- **علاقه‌مندی‌ها**: به دستورهایی که زیاد استفاده می‌کنی ستاره بده؛ فقط توی مرورگر خودت ذخیره می‌شه
- **بدون ثبت‌نام، بدون لاگین** — بازدیدکننده فقط می‌تونه بگرده و کپی کنه، هیچ‌جوره نمی‌تونه چیزی اضافه یا عوض کنه

## پنل ادمین

مدیریت محتوا فقط دست صاحب سایته، از صفحه `/admin` با رمز عبور:

- اضافه، ویرایش و حذف دستور (دستور، عنوان، توضیح، دسته، تگ، مثال، سطح کاربرد)
- اضافه، ویرایش و حذف دسته (حذف دسته‌ای که دستور داره، اول باید دستورهاش رو جابه‌جا یا پاک کنی)
- ورود با رمز عبور — رمز توی کد نیست، با `wrangler secret` ست می‌شه (پایین رو ببین)

## اجرای محلی

```sh
git clone https://github.com/erffanhub-00/web-cheat-terminal.git
cd web-cheat-terminal
npm install
npm run seed:local   # دیتابیس محلی رو می‌سازه و ۱۳۹۲ دستور رو می‌ریزه توش
npm run dev          # http://localhost:8787
```

برای تست محلی رمز ادمین `admin123` هست — **فقط برای تست محلی** (از فایل `.dev.vars` که هیچ‌وقت کامیت نمی‌شه می‌خونه)، و پنل ادمین وقتی این رمز فعاله یه هشدار نشون می‌ده. روی سایت واقعی تا وقتی رمز واقعی رو با `wrangler secret` ست نکنی، ورود ادمین کلاً غیرفعاله — هیچ رمز پیش‌فرضی روی سایت زنده کار نمی‌کنه.

## دیپلوی روی Cloudflare (رایگان)

سایت همین حالا هم دیپلوی شده: https://web-cheat-terminal.terminal88project.workers.dev — دیتابیس D1 اسمش `cheat-terminal` هست (آی‌دی `f5ed3d74-8468-4496-8e72-c80b12d1bbd7`) و ۱۳۹۲ دستور توش سید شده. برای دیپلوی دوباره یا از اول:

```sh
npx wrangler login
npx wrangler d1 create cheat-terminal
```

آی‌دی‌ای که چاپ می‌شه رو بذار جای `database_id` توی `wrangler.toml`، بعد:

```sh
npx wrangler d1 migrations apply cheat-terminal --remote
npm run seed:remote
npx wrangler secret put ADMIN_PASSWORD
npx wrangler deploy
```

سایت روی `https://web-cheat-terminal.<your-subdomain>.workers.dev` بالا میاد. رمز ادمین رو با این دستور ست می‌کنی:

```sh
npx wrangler secret put ADMIN_PASSWORD
```

بعد از وارد کردن رمز، اون رمز هم برای ورود به پنل ادمینه، هم کلید امضای نشست‌ها — عوض کردنش همه نشست‌های قبلی رو باطل می‌کنه.

## API

همه خروجی‌ها JSON هستن:

- `GET /api/categories` — دسته‌ها با تعداد دستور
- `GET /api/entries?q=&category=&level=&ids=&limit=&offset=` — جست‌وجو و فیلتر؛ `level` عدد (۱ تا ۳) یا اسم (essential/common/advanced) می‌گیره؛ `ids` لیست آی‌دی با کاما برای علاقه‌مندی‌ها
- `GET /api/entries/:id` — یه دستور
- `POST /api/admin/login` — ‏`{ "password": "..." }`‏، کوکی نشست می‌ذاره
- `GET /api/admin/me` ،`POST /api/admin/logout`
- `GET/POST /api/admin/entries` ،`PUT/DELETE /api/admin/entries/:id`
- `GET/POST /api/admin/categories` ،`PUT/DELETE /api/admin/categories/:name`

## تست

```sh
npm test
```

۲۵ تست واحد برای هندلرهای API (جست‌وجو، فیلتر، سطح، CRUD، ورود/رد ادمین) — همه باید سبز باشن. برای اسموک‌تست واقعی هم `bash scripts/smoke-test.sh` رو اجرا کن: سرور محلی رو بالا می‌یاره و صفحه‌ها و API رو با curl چک می‌کنه (صفحه اصلی، `/api/categories`، `/api/entries` با ۱۳۹۲ رکورد، ورود ادمین با رمز اشتباه باید ۴۰۱ بده).

## تکنولوژی

Cloudflare Workers (جاوااسکریپت ساده، بدون بیلد) + D1 (همون SQLite) + فرانت استاتیک روی خود ورکر. بدون وابستگی ران‌تایم؛ فقط wrangler برای توسعه و دیپلوی لازمه.

## Me

[![Telegram](https://img.shields.io/badge/Telegram-erffan__hub-blue?style=for-the-badge&logo=telegram)](https://t.me/erffan_hub)
[![Twitter](https://img.shields.io/badge/Twitter-@Erffanhub__00-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/Erffanhub_00)
[![Gist](https://img.shields.io/badge/Gist-Profile-000000?style=for-the-badge&logo=github)](https://gist.github.com/erffanhub-00)
[![Github](https://img.shields.io/badge/Github-Profile-000000?style=for-the-badge&logo=github)](https://github.com/erffanhub-00)
