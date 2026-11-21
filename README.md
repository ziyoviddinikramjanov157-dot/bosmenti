# Bosmenti — erkaklar kiyim do‘koni

Do‘konning sayti, kassa va omborli admin paneli hamda serveri.

| Papka | Nima |
| --- | --- |
| [`bosmenti-app`](bosmenti-app) | Do‘kon sayti va admin panel (React + TypeScript + Vite) |
| [`bosmenti-server`](bosmenti-server) | Server: buyurtmalar, savdolar, ombor, to‘lovlar, hisobot (Node.js + PostgreSQL) |

## Nimalar bor

**Sayt** — katalog, chegirmali narxlar, tugagan o‘lchamlar belgilanadi, savat, naqd yoki do‘kon kartasiga o‘tkazma, buyurtma holatini kuzatish.

**Admin panel** (`/admin`, do‘kondagi POS apparatda ham ochiladi):

- **Kassa** — shtrix-kod skaneri bilan savdo: naqd, karta, aralash, qisman yoki nasiya; chek chiqarish.
- **Kirim** — yangi tovarni skanerlab omborga qo‘shish.
- **Ombor** — rang va o‘lcham bo‘yicha qoldiq, sanoq, shtrix-kodli yorliqlar.
- **Savdolar** — do‘kon va sayt savdolari, har bir to‘lov sana-vaqti bilan, qarzdorlar.
- **Chegirmalar**, **Hisobot** (do‘kon va sayt, naqd va karta, qarzlar), **Mahsulotlar**, **Sozlamalar**.
- Saytdan kelgan har bir yangi buyurtma Telegram'ga xabar bo‘lib keladi.

Serverga chiqarish, POS apparatni sozlash va Telegram: [`bosmenti-server/README.md`](bosmenti-server/README.md).
