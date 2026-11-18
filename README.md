# web-cheat-terminal

نسخه وب cheat-terminal — چیت‌شیت‌هات رو از مرورگر بگرد، بدون نصب هیچی. همون دستورهای نسخه ترمینال (لینوکس، پاورشل، داکر، گیت) با جست‌وجوی زنده، دسته‌بندی، فیلتر کاربردی بودن و کپی با یه کلیک.

**سایت زنده:** https://web-cheat-terminal.terminal88project.workers.dev

- **جست‌وجوی زنده** موقع تایپ — توی دستور، عنوان، توضیح و تگ‌ها. بهترین نتیجه اول میاد: دستوری که دقیقاً همون چیزیه که تایپ کردی اول، بعد دستوری که باهاش شروع می‌شه، بعد بقیه.
- **مرورگر کامل**: سایدبار دسته‌ها با تعداد زنده، لیست نتایج، و پنل جزئیات که دستور رو بهت یاد می‌ده — چیکار می‌کنه، مثال (اگه داشته باشه)، و تگ‌هاش.
- **کپی** هر دستور با یه کلیک
- **فیلتر کاربردی بودن**: Essential ،Common یا Advanced — هر دستور یه درجه داره
- **علاقه‌مندی‌ها**: به دستورهایی که زیاد استفاده می‌کنی ستاره بده؛ فقط توی مرورگر خودت ذخیره می‌شه
- **تاریخچه**: دستورهایی که اخیراً دیدی یا کپی کردی، همون توی سایدبار. روشون کلیک کن دوباره باز می‌شن، هر وقت خواستی پاکشون کن. اینم مثل علاقه‌مندی‌ها فقط توی مرورگر خودت ذخیره می‌شه
- **بدون ثبت‌نام، بدون لاگین** — بازدیدکننده فقط می‌تونه بگرده و کپی کنه، هیچ‌جوره نمی‌تونه چیزی اضافه یا عوض کنه

## پنل ادمین

مدیریت محتوا فقط دست صاحب سایته، از صفحه `/admin` با رمز عبور — آدرس رو توی مرورگر تایپ کن، توی سایت هیچ لینکی بهش نیست:

- اضافه، ویرایش و حذف دستور (دستور، عنوان، توضیح، دسته، تگ، مثال، سطح کاربرد)
- اضافه، ویرایش و حذف دسته (حذف دسته‌ای که دستور داره، اول باید دستورهاش رو جابه‌جا یا پاک کنی)
- پیدا کردن سریع هرچی: لیست دستورها جست‌وجوی زنده داره، به‌علاوه فیلتر دسته و سطح کاربرد، و صفحه‌به‌صفحه لود می‌شه تا همیشه سریع بمونه.
- ایمپورت و اکسپورت با فایل: همه‌چی رو به‌صورت یه فایل JSON دانلود کن، ویرایشش کن و برگردون تو. ایمپورت اول پیش‌نمایش نشون می‌ده — چندتا جدیده، چندتا آپدیت می‌شه، چندتا بدون تغییر می‌مونه — و یه دستور موجود رو فقط وقتی آپدیت می‌کنه که فایل حرف بیشتری برای گفتن داشته باشه.
- ورود با رمز عبور — رمز توی کد نیست، با `wrangler secret` ست می‌شه (پایین رو ببین). تا وقتی رمز ست نشده، ورود ادمین کلاً غیرفعاله — هیچ رمز پیش‌فرضی روی سایت زنده کار نمی‌کنه.

## اجرای محلی

```sh
git clone https://github.com/erffanhub-00/web-cheat-terminal.git
cd web-cheat-terminal
npm install
npm run seed:local   # دیتابیس محلی رو می‌سازه و از data/seed.json پرش می‌کنه
npm run dev          # http://localhost:8787
```

برای تست محلی، یه فایل به اسم `.dev.vars` بساز و یه رمز برای استفاده محلی خودت توش بذار:

```sh
ADMIN_PASSWORD=<یه رمزی که خودت برای تست محلی انتخاب می‌کنی>
```

این فایل فقط روی کامپیوتر خودت می‌مونه — gitignore شده و هیچ‌وقت کامیت نمی‌شه. روی سایت واقعی رمز از سکرت ورکر میاد.

## دیپلوی روی Cloudflare (رایگان)

سایت همین حالا هم دیپلوی شده: https://web-cheat-terminal.terminal88project.workers.dev — دیتابیس D1 اسمش `cheat-terminal` هست (آی‌دی `f5ed3d74-8468-4496-8e72-c80b12d1bbd7`). برای دیپلوی دوباره یا از اول:

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
- `GET /api/admin/export` — دانلود همه دستورها و دسته‌ها به‌صورت یه فایل JSON (فرمت سید)
- `POST /api/admin/import` — آپلود فایل JSON؛ با `?dryRun=1` پیش‌نمایش ایمپورت رو نشون می‌ده بدون اینکه چیزی بنویسه

## تست

```sh
npm test
```

تست‌های واحد برای هندلرهای API (جست‌وجو و رتبه‌بندی، فیلتر، سطح، CRUD، ورود/رد ادمین) — همه باید سبز باشن. برای اسموک‌تست واقعی هم `bash scripts/smoke-test.sh` رو اجرا کن: سرور محلی رو بالا می‌یاره و صفحه‌ها و API رو با curl چک می‌کنه (صفحه اصلی، `/api/categories`، رتبه‌بندی جست‌وجو، ورود ادمین با رمز اشتباه باید ۴۰۱ بده).

## تکنولوژی

Cloudflare Workers (جاوااسکریپت ساده، بدون بیلد) + D1 (همون SQLite) + فرانت استاتیک روی خود ورکر. بدون وابستگی ران‌تایم؛ فقط wrangler برای توسعه و دیپلوی لازمه.

## Me

[![Telegram](https://img.shields.io/badge/Telegram-erffan__hub-blue?style=for-the-badge&logo=telegram)](https://t.me/erffan_hub)
[![Twitter](https://img.shields.io/badge/Twitter-@Erffanhub__00-000000?style=for-the-badge&logo=x&logoColor=white)](https://x.com/Erffanhub_00)
[![Gist](https://img.shields.io/badge/Gist-Profile-000000?style=for-the-badge&logo=github)](https://gist.github.com/erffanhub-00)
[![Github](https://img.shields.io/badge/Github-Profile-000000?style=for-the-badge&logo=github)](https://github.com/erffanhub-00)
