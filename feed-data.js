const STAY = "6–8 ноября, 2 ночи, 2 взрослых";

const DEFAULT_FEED = [
  {
    id: "ns54L7UnjimHvsCGa9b1j6",
    title: "Цветущий Дагестан",
    text: "Цветущий Дагестан. Короткий ролик про Махачкалу: в реестре у него нет отдельного текста, только это название. Ниже отель, который Туту показал первым на эти даты.",
    offers: [hotel("Отель MoonLit", "8549 ₽ за 2 ночи", "Махачкала, Республика Дагестан. Бесплатная отмена. Завтрак Туту не указал.", "https://cdn4.tu-tu.ru/static/hotels-photo/hotels-photo/2247a56f2a08085dc056fe52b7ef01dc2aa00816.6bf2fefcac2e07ffb6f3a65b83b31762c4b2ea49.jpeg", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=10558306&geo_name=%D0%9C%D0%B0%D1%85%D0%B0%D1%87%D0%BA%D0%B0%D0%BB%D0%B0&room%5B0%5D=2&search_id=908715a3e3eaec1ea677535fa1b0a8cc")],
  },
  {
    id: "eFKMXotDNvs6g9Kjqgrytx",
    title: "Выходные в Карелии",
    text: "Выходные в Карелии. Ролик про Петрозаводск, отдельного описания автора в реестре нет. Карточка ведёт на страницу отеля с уже подставленными датами.",
    offers: [hotel("Фрегат", "13287 ₽ за 2 ночи", "Петрозаводск, Республика Карелия. 4 звезды. Завтрак «шведский стол». Бесплатная отмена.", "https://cdn2.tu-tu.ru/imghub/view/212cf84e-f051-4c24-a2b2-a75686dcfba2/resize_500_500/4271b6c12b3a41b87b17f2bfcd92ed9a/fc74dd706ab874e0ee20fabd5db2c4fc.jpg", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=11443104&geo_name=%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%B7%D0%B0%D0%B2%D0%BE%D0%B4%D1%81%D0%BA&room%5B0%5D=2&search_id=1c3e77ff99be685f3d61410bdf017ae5")],
  },
  {
    id: "e2i4VcBbPwGRp4cDUe4Q5W",
    title: "Секреты Розы Хутор",
    text: "Секреты Розы Хутор. Короткий ролик про курорт. В отельном индексе у самой Розы Хутор пусто, поэтому отель взят по горнолыжному курорту «Красная Поляна». Сверху — прямой рейс из Москвы.",
    offers: [
      {
        title: "Самолёт в Сочи",
        price: "от 3338.05₽",
        label: "Победа DP-5945, 6 ноября, 07:10–11:00, прямой, Шереметьево (SVO), терм. D → Сочи, AER. Базовый, без багажа, ручная кладь 1 место 36×30×27. 3338.05 ₽ за 1 взрослого, снимок поиска 19 октября.",
        image: null,
        href: "https://avia.tutu.ru/f/Moskva/Sochi/?class=Y&travelers=1&route[0]=491-06112026-78&utm_source=grok&utm_medium=mcp",
      },
      hotel("Сочи Марриотт Красная Поляна", "30320 ₽ за 2 ночи", "Горнолыжный курорт «Красная Поляна». 5 звёзд. Завтрак «шведский стол». Бесплатная отмена. По самой Розе Хутор Туту не вернул отели.", "https://cdn2.tu-tu.ru/imghub/view/892c50d8-eb72-402e-9928-bb6e8e11679f/resize_500_500/4271b6c12b3a41b87b17f2bfcd92ed9a/48a56a9f485f5ef4898d251c7364a6ea.jpg", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=7646252&geo_name=%D0%93%D0%BE%D1%80%D0%BD%D0%BE%D0%BB%D1%8B%D0%B6%D0%BD%D1%8B%D0%B9%20%D0%BA%D1%83%D1%80%D0%BE%D1%80%D1%82%20%22%D0%9A%D1%80%D0%B0%D1%81%D0%BD%D0%B0%D1%8F%20%D0%9F%D0%BE%D0%BB%D1%8F%D0%BD%D0%B0%22&room%5B0%5D=2&search_id=8870df1656070480f1ea288074ed3e9c"),
    ],
  },
  {
    id: "p4c2nCUvE95qAmtEUq9Tf8",
    title: "Великолепный Муром",
    text: "Великолепный Муром. В реестре ролик подписан «Тут был Илья Муромец», другого текста нет. Карточка — первый отель Мурома на 6–8 ноября.",
    offers: [hotel("X.ROOM", "13182 ₽ за 2 ночи", "Муром, Владимирская область. 4 звезды. Бесплатная отмена. Завтрак Туту не указал.", "https://cdn4.tu-tu.ru/static/hotels-photo/hotels-photo/2e52b363074701175bcee5cbeffded2c260d518d.930eea2cb91b9442a2c27f8ff2c2e48d83386fdb.jpeg", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=11520283&geo_name=%D0%9C%D1%83%D1%80%D0%BE%D0%BC&room%5B0%5D=2&search_id=6149c8c12cba766427f198ce35c2f4bb")],
  },
  {
    id: "gyqQRJbPDuhH9Po2heGetf",
    title: "Маршрут по Хибинам",
    text: "Маршрут по Хибинам. Короткий ролик без отдельного описания. Отель искали в Кировске Мурманской области: это город у Хибин, не одноимённый Кировск в другом регионе.",
    offers: [hotel("Гостиница Северная", "20100 ₽ за 2 ночи", "Кировск, Мурманская область. 3 звезды. Континентальный завтрак. Бесплатная отмена.", "https://cdn.ostrovok.ru/t/x500/extranet/64/51/645102c2013bb3cd55b2bc285a1dabf0ac5e97fb.WEBP", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=11410302&geo_name=%D0%9A%D0%B8%D1%80%D0%BE%D0%B2%D1%81%D0%BA&room%5B0%5D=2&search_id=6b46cec665fd9932d8cf2089f71f8bff")],
  },
  {
    id: "qRK3cppTQQQjCKAPEZ2m5s",
    title: "Солнечная Армения",
    text: "Солнечная Армения. Ролик про Ереван, в реестре только название. Карточка открывает страницу отеля, комнату ещё нужно выбрать.",
    offers: [hotel("Hotel Merien", "8917 ₽ за 2 ночи", "Ереван, Армения. 3 звезды. Бесплатная отмена. Завтрак Туту не указал.", "https://cdn.ostrovok.ru/t/x500/extranet/fb/53/fb5360820747b3ea2b3197c692bc62f6c6a23561.jpeg", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=6845252&geo_name=%D0%95%D1%80%D0%B5%D0%B2%D0%B0%D0%BD&room%5B0%5D=2&search_id=f4f0fbfb9351512934105ef994695a4d")],
  },
  {
    id: "dBoYCW8FxmozAbviT2x3MR",
    title: "Суздаль для души",
    text: "Суздаль для души. Короткий ролик без авторского текста длиннее названия. Отель ниже — первый в выдаче Суздаля на те же даты, что и остальные карточки.",
    offers: [hotel("Апарт-отель Пролетарский Дворик", "13680 ₽ за 2 ночи", "Суздаль, Владимирская область. Бесплатная отмена. Завтрак Туту не указал.", "https://cdn.ostrovok.ru/t/x500/extranet/34/77/3477093c55d7c427969a59844198b226b3059ed6.jpeg", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=7801430&geo_name=%D0%A1%D1%83%D0%B7%D0%B4%D0%B0%D0%BB%D1%8C&room%5B0%5D=2&search_id=1c240d0577d81171af34723283033404")],
  },
  {
    id: "dMNvwVaWP6nYjmHg45dgab",
    title: "Едем на Домбай",
    text: "Едем на Домбай. Ролик про сам посёлок, отдельного описания нет. Искали зону «Домбай»: Туту собрал её как курорт, а не одну улицу.",
    offers: [hotel("ГК Гранд-Отель", "7220 ₽ за 2 ночи", "Домбай. Бесплатная отмена. Завтрак Туту не указал.", "https://cdn.ostrovok.ru/t/x500/extranet/6f/4b/6f4ba435bcb901fa3fd4a7f7f4743a27a20094cb.JPEG", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=7800756&geo_name=%D0%94%D0%BE%D0%BC%D0%B1%D0%B0%D0%B9&room%5B0%5D=2&search_id=2fb2f991afc8430572f333a8624c97e5")],
  },
  {
    id: "3uQ6jYfAMX8Gvz3JDxxX65",
    title: "Прогулка и крендели Выборга",
    text: "Прогулка и крендели Выборга. Название и есть всё описание из реестра. Карточка — гостиница в Выборге на 6–8 ноября, завтрак уже входит в этот тариф.",
    offers: [hotel("Гостиница «Выборг»", "10260 ₽ за 2 ночи", "Выборг, Ленинградская область. 3 звезды. Завтрак «шведский стол». Бесплатная отмена.", "https://cdn2.tu-tu.ru/imghub/view/0f30d2a0-3401-44a1-9f2d-6f569bdfbeac/resize_500_500/4271b6c12b3a41b87b17f2bfcd92ed9a/2d04b4acba7982c63a91846cbef56e4e.jpg", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=11411003&geo_name=%D0%92%D1%8B%D0%B1%D0%BE%D1%80%D0%B3&room%5B0%5D=2&search_id=4e0bd007e871a6c07e1cd0409a8f04bd")],
  },
  {
    id: "pCrAAnPgnRrM8TCMQMZNpN",
    title: "Красота Камчатки",
    text: "Красота Камчатки. Короткий ролик про Петропавловск-Камчатский, длинного текста автора нет. Отель ниже — первый в выдаче города на эти даты.",
    offers: [hotel("Гостиница «Авача»", "15865 ₽ за 2 ночи", "Петропавловск-Камчатский, Камчатский край. 3 звезды. Бесплатная отмена. Завтрак Туту не указал.", "https://cdn4.tu-tu.ru/static/hotels-photo/hotels-photo/1e77895e80a811bc0753553e80aa952e2bd25dc6.4c4767480f538efdd3b05e53487af64cc8278913.jpeg", "https://hotel.tutu.ru/offers/details?business=0&check_in=2026-11-06&check_out=2026-11-08&geo_id=11443544&geo_name=%D0%9F%D0%B5%D1%82%D1%80%D0%BE%D0%BF%D0%B0%D0%B2%D0%BB%D0%BE%D0%B2%D1%81%D0%BA-%D0%9A%D0%B0%D0%BC%D1%87%D0%B0%D1%82%D1%81%D0%BA%D0%B8%D0%B9&room%5B0%5D=2&search_id=18e61b183075bcc72cdca3b54158e741")],
  },
];

function hotel(title, price, detail, image, href) {
  return {
    title: title,
    price: price,
    label: title + ". " + STAY + ". " + detail + " Цена — итог за весь срок, снимок поиска 20 октября.",
    image: image,
    href: href + "&utm_source=grok&utm_medium=mcp",
  };
}
