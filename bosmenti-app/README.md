# Bosmenti — erkaklar kiyim do‘koni (sayt va admin panel)

Do‘konning sayti va boshqaruv paneli. React + TypeScript + Vite. Ma’lumotlarni serverdan (`../bosmenti-server`) oladi.

**Sayt (xaridor uchun)**

- Birinchi ochilganda do‘kon haqidagi landing sahifasi chiqadi, ro‘yxatdan o‘tish so‘ralmaydi.
- Chegirmali narxlar eski narx chizilgan holda ko‘rsatiladi; omborda tugagan o‘lchamni tanlab bo‘lmaydi.
- Buyurtma berishda mijoz ismi va telefon raqamini qoldiradi. To‘lov: kiyimni olganda naqd yoki do‘kon kartasiga o‘tkazma.
- Mijoz buyurtmasi holatini “Profil” bo‘limida ko‘radi.
- Sayt telefon va kompyuter ekraniga moslashadi.

**Admin panel (`/admin`) — do‘kondagi POS apparatda ham ishlaydi**

- **Kassa:** shtrix-kod skaneri bilan savdo; naqd, karta, aralash, qisman yoki nasiya; qaytim; chek.
- **Kirim:** yangi tovarni skanerlab omborga qo‘shish; yangi kodni kiyimga bir marta bog‘lash.
- **Ombor:** rang va o‘lcham bo‘yicha qoldiq, sanoq, shtrix-kodli yorliqlar.
- **Savdolar:** do‘kon va sayt savdolari bitta ro‘yxatda, to‘lovlar sana-vaqti bilan, qarzdorlar.
- **Mahsulotlar, Chegirmalar, Hisobot, Sozlamalar.**

Serverga chiqarish va ishga tushirish: [`../bosmenti-server/README.md`](../bosmenti-server/README.md).

## Tuzilishi

```
index.html, admin.html  ikki sahifa: do‘kon va admin panel
src/
  main.tsx              katalogni serverdan yuklab, do‘konni ochadi
  App.tsx               ekranlarni almashtiradi
  store.tsx             holat: navigatsiya, savat, sevimlilar, buyurtma berish
  data/catalog.ts       serverdan kelgan katalog (bo‘limlar, mahsulotlar, o‘lchamlar, do‘kon ma’lumotlari)
  lib/api.ts            server bilan aloqa
  components/, screens/ do‘kon ekranlari
  admin/                boshqaruv paneli: kassa, kirim, ombor, savdolar, mahsulotlar, chegirmalar, hisobot, sozlamalar
  admin/pos.ts          skaner, chek va shtrix-kodli yorliq chop etish
public/img/             do‘konning boshlang‘ich fotolari (manbalari: public/img/CREDITS.md)
```

## Mobil ilova (Play Market, App Store)

[Capacitor](https://capacitorjs.com) yordamida ilovaga aylantiriladi. Ilova ichida sayt boshqa manzildan ochilgani uchun server manzilini ko‘rsatib yig‘ing:

```bash
VITE_API_URL=https://bosmenti.uz npm run build
```

Bunda serverda shu ilova manzilidan so‘rovlarga ruxsat (CORS) qo‘shish kerak bo‘ladi.
