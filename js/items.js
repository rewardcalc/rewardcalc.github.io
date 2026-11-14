/*
 * 물약·음식 데이터 (MapleStory Classic)
 * - 회복량 / 효과 / NPC 구매가 / 되팔기 가격: meowdb.com 아이템 DB (Use → Food, Potion, Buff, 2026-11-14 수집)
 *   Buff 분류 14개 중 제작 키트 6개·GM 버프 3개는 물약이 아니고 게임 파일에 아이콘도 없어서 뺐다
 * - 한글 이름: maple.inven.co.kr 아이템 DB와 아이콘 그림·이름을 비교해서 매칭
 *   ko 뒤에 tr:true 가 붙은 항목은 인벤(한국 메이플)에 없는 아이템이라 직접 번역한 이름
 * - 아이콘: 게임 클라이언트(Item.wz) 원본, assets/items/<icon>.png
 *
 * id    : meowdb 아이템 번호
 * icon  : 아이콘 파일 번호
 * kind  : potion(포션) / food(음식) / buff(버프)
 * hp,mp : 회복량. 숫자 = 고정치, '35%' 같은 문자열 = 최대치 비율
 * buff  : 버프 효과 설명
 * buy   : NPC 상점 구매가 (null = NPC가 팔지 않음)
 * sell  : NPC 되팔기 가격
 */
export const ITEMS = [
  { id: 2000000, icon: 2000000, en: 'Red Potion',            ko: '빨간 포션',            kind: 'potion', hp: 100,   mp: 0,     buy: 50,   sell: 5 },
  { id: 2000001, icon: 2000001, en: 'Orange Potion',         ko: '주황 포션',            kind: 'potion', hp: 250,   mp: 0,     buy: 150,  sell: 15 },
  { id: 2000002, icon: 2000002, en: 'White Potion',          ko: '하얀 포션',            kind: 'potion', hp: 500,   mp: 0,     buy: 350,  sell: 35 },
  { id: 2000003, icon: 2000003, en: 'Blue Potion',           ko: '파란 포션',            kind: 'potion', hp: 0,     mp: 200,   buy: 220,  sell: 22 },
  { id: 2000004, icon: 2000004, en: 'Elixir',                ko: '엘릭서',               kind: 'potion', hp: '35%', mp: '35%', buy: 3000, sell: 500 },
  { id: 2000005, icon: 2000005, en: 'Power Elixir',          ko: '파워 엘릭서',          kind: 'potion', hp: '100%',mp: '100%',buy: null, sell: 2500 },
  { id: 2000006, icon: 2000006, en: 'Mana Elixir',           ko: '마나 엘릭서',          kind: 'potion', hp: 0,     mp: '50%', buy: null, sell: 1000 },
  { id: 2000007, icon: 2000000, en: 'Red Potion (Alt)',      ko: '빨간 포션 (다른 버전)',  kind: 'potion', hp: 100,   mp: 0,     buy: null, sell: 5 },
  { id: 2000008, icon: 2000003, en: 'Blue Potion (Alt)',     ko: '파란 포션 (다른 버전)',  kind: 'potion', hp: 0,     mp: 200,   buy: null, sell: 22 },

  { id: 2010001, icon: 2010000, en: 'Apple',                 ko: '사과',                 kind: 'food', hp: 40,    mp: 0,     buy: 20,   sell: 2 },
  { id: 2010000, icon: 2010007, en: "Roger's Apple",         ko: '로저의 사과',          kind: 'food', hp: 30,    mp: 0,     buy: null, sell: null },
  { id: 2010007, icon: 2010009, en: 'Green Apple',           ko: '초록사과',             kind: 'food', hp: 0,     mp: 30,    buy: null, sell: 3 },
  { id: 2010002, icon: 2010002, en: 'Egg',                   ko: '달걀',                 kind: 'food', hp: 60,    mp: 0,     buy: 30,   sell: 3 },
  { id: 2010003, icon: 2010001, en: 'Meat',                  ko: '짐승의 고기',          kind: 'food', hp: 160,   mp: 0,     buy: 80,   sell: 8 },
  { id: 2010004, icon: 2010003, en: 'Orange',                ko: '오렌지',               kind: 'food', hp: 0,     mp: 50,    buy: 50,   sell: 5 },
  { id: 2010005, icon: 2010004, en: 'Lemon',                 ko: '레몬',                 kind: 'food', hp: 0,     mp: 150,   buy: 150,  sell: 15 },
  { id: 2010008, icon: 2010004, en: 'Lemon (Alt)',           ko: '레몬 (다른 버전)',       kind: 'food', hp: 0,     mp: 150,   buy: null, sell: 15 },
  { id: 2010006, icon: 2001000, en: 'Watermelon',            ko: '수박',                 kind: 'food', hp: 800,   mp: 800,   buy: 1920, sell: 192 },
  { id: 2020000, icon: 2020000, en: 'Salad',                 ko: '샐러드',               kind: 'food', hp: 0,     mp: 200,   buy: 220,  sell: 22 },
  { id: 2020001, icon: 2020001, en: 'Fried Chicken',         ko: '통닭',                 kind: 'food', hp: 120,   mp: 0,     buy: 60,   sell: 6 },
  { id: 2020002, icon: 2020002, en: 'Cake',                  ko: '케이크',               kind: 'food', hp: 100,   mp: 100,   buy: 150,  sell: 15 },
  { id: 2020023, icon: 2020002, en: 'Cake (Alt)',            ko: '케이크 (다른 버전)',     kind: 'food', hp: 100,   mp: 100,   buy: null, sell: 15 },
  { id: 2020003, icon: 2020003, en: 'Pizza',                 ko: '피자',                 kind: 'food', hp: 360,   mp: 0,     buy: 252,  sell: 25 },
  { id: 2020004, icon: 2020004, en: 'Hamburger',             ko: '햄버거',               kind: 'food', hp: 500,   mp: 0,     buy: 350,  sell: 35 },
  { id: 2020005, icon: 2020005, en: 'Hot Dog',               ko: '길쭉이 핫도그',        kind: 'food', hp: 300,   mp: 0,     buy: 180,  sell: 18 },
  { id: 2020006, icon: 2020006, en: 'Hot Dog Supreme',       ko: '뚱뚱이 핫도그',        kind: 'food', hp: 600,   mp: 0,     buy: 480,  sell: 48 },
  { id: 2020007, icon: 2020007, en: 'Dried Squid',           ko: '마른 오징어',          kind: 'food', hp: 300,   mp: 0,     buy: 180,  sell: 18 },
  { id: 2020008, icon: 2020008, en: 'Fat Sausage',           ko: '천하장사',             kind: 'food', hp: 800,   mp: 0,     buy: 800,  sell: 80 },
  { id: 2020009, icon: 2020009, en: 'Orange Juice',          ko: '오렌지 주스',          kind: 'food', hp: 0,     mp: 450,   buy: 540,  sell: 54 },
  { id: 2020010, icon: 2020010, en: 'Grape Juice',           ko: '포도 주스',            kind: 'food', hp: 0,     mp: 900,   buy: 1260, sell: 126 },
  { id: 2020011, icon: 2020011, en: 'W Ramen',               ko: 'W 라멘', tr: true,      kind: 'food', hp: '40%', mp: '40%', buy: null, sell: 200 },
  { id: 2020012, icon: 2001001, en: 'Ice Cream Pop',         ko: '쭈쭈바',               kind: 'food', hp: 1500,  mp: 0,     buy: 1500, sell: 150 },
  { id: 2020013, icon: 2001002, en: 'Red Bean Sundae',       ko: '팥빙수',               kind: 'food', hp: 0,     mp: 1500,  buy: 2250, sell: 225 },
  { id: 2020020, icon: 2022106, en: "Red Malady's Candy",    ko: '빨간 말라디 사탕', tr: true,   kind: 'food', hp: 600, mp: 0,   buy: null, sell: 1 },
  { id: 2020022, icon: 2022105, en: "Green Malady's Candy",  ko: '초록 말라디 사탕', tr: true,   kind: 'food', hp: 300, mp: 300, buy: null, sell: 1 },
  { id: 2020021, icon: 2022107, en: "Blue Malady's Candy",   ko: '파란 말라디 사탕', tr: true,   kind: 'food', hp: 0,   mp: 450, buy: null, sell: 1 },
  { id: 2022000, icon: 2022000, en: 'Pure Water',            ko: '맑은 물',              kind: 'food', hp: 0,     mp: 800,   buy: 1120, sell: 112 },
  { id: 2022003, icon: 2022003, en: 'Unagi',                 ko: '장어 구이',            kind: 'food', hp: 1000,  mp: 0,     buy: 1000, sell: 100 },

  { id: 2002000, icon: 2002004, en: 'Warrior Potion',        ko: '전사의 물약',          kind: 'buff', hp: 0, mp: 0, buff: '공격력 +10 (10분)',         buy: 500,  sell: 250 },
  { id: 2002001, icon: 2002002, en: 'Magic Potion',          ko: '마법사의 물약',        kind: 'buff', hp: 0, mp: 0, buff: '마력 +10 (10분)',           buy: 500,  sell: 250 },
  { id: 2002002, icon: 2002005, en: 'Sniper Potion',         ko: '명사수의 물약',        kind: 'buff', hp: 0, mp: 0, buff: '명중치 +5 (10분)',          buy: 500,  sell: 250 },
  { id: 2002003, icon: 2002000, en: 'Dexterity Potion',      ko: '민첩함의 물약',        kind: 'buff', hp: 0, mp: 0, buff: '회피치 +5 (10분)',          buy: 500,  sell: 250 },
  { id: 2002004, icon: 2002001, en: 'Speed Potion',          ko: '속도향상의 물약',      kind: 'buff', hp: 0, mp: 0, buff: '이동속도 +8 (10분)',        buy: 500,  sell: 250 },
  { id: 2012000, icon: 2012000, en: "Drake's Blood",         ko: '드레이크의 피',        kind: 'buff', hp: 0, mp: 0, buff: '공격력 +12 (5분)',          buy: null, sell: 300 },
  { id: 2012001, icon: 2012001, en: "Fairy's Honey",         ko: '요정의 꿀',            kind: 'buff', hp: 0, mp: 0, buff: '회피치 +10 (5분)',          buy: null, sell: 250 },
  { id: 2012002, icon: 2012002, en: 'Sap of Ancient Tree',   ko: '고목 나무의 수액',     kind: 'buff', hp: 0, mp: 0, buff: '마력 +12 (5분)',            buy: null, sell: 300 },
  { id: 2012003, icon: 2012003, en: "Drake's Meat",          ko: '드레이크의 고기',      kind: 'buff', hp: 0, mp: 0, buff: '물리방어력 +10 (5분)',      buy: null, sell: 250 },
  { id: 2022002, icon: 2022002, en: 'Cider',                 ko: '사이다', tr: true,      kind: 'buff', hp: 0, mp: 0, buff: '공격력 +15, 명중치 -5 (5분)', buy: null, sell: 1 }
];

/*
 * 몬스터가 드랍하는 기타 아이템 (meowdb Etc → Monster Drop 분류, 2026-11-14 수집)
 * sell : NPC에게 팔 때 받는 가격 (개당)
 * icon : assets/etc/<icon>.png — 숫자는 게임 클라이언트(Item.wz) 원본, n으로 시작하면 클래식 신규 아이템이라 meowdb 원본
 * 한글 이름: 인벤 기타 아이템 DB(같은 아이템 번호·아이콘), 인벤에 없으면 meowdb 한국어 이름, tr:true 는 직접 번역
 */
export const ETC = [
  { id: 347, icon: '4000083', en: "Jr. Sentinel Shellpiece", ko: '주니어 스톤볼의 돌조각', sell: 0 },
  { id: 348, icon: '4000019', en: "Snail Shell", ko: '달팽이의 껍질', sell: 1 },
  { id: 349, icon: '4000000', en: "Blue Snail Shell", ko: '파란 달팽이의 껍질', sell: 2 },
  { id: 350, icon: '4000011', en: "Mushroom Spore", ko: '버섯의 포자', sell: 3 },
  { id: 351, icon: '4000016', en: "Red Snail Shell", ko: '빨간 달팽이의 껍질', sell: 4 },
  { id: 352, icon: '4000003', en: "Tree Branch", ko: '나뭇가지', sell: 5 },
  { id: 353, icon: '4000004', en: "Squishy Liquid", ko: '물컹물컹한 액체', sell: 6 },
  { id: 354, icon: '4000010', en: "Slime Bubble", ko: '슬라임의 방울', sell: 50 },
  { id: 355, icon: '4000017', en: "Pig's Head", ko: '돼지의 머리', sell: 7 },
  { id: 356, icon: '4000001', en: "Orange Mushroom Cap", ko: '주황버섯의 갓', sell: 8 },
  { id: 357, icon: '4000002', en: "Pig's Ribbon", ko: '돼지의 리본', sell: 10 },
  { id: 358, icon: '4000005', en: "Leaf", ko: '나뭇잎', sell: 11 },
  { id: 359, icon: '4000006', en: "Octopus Leg", ko: '옥토퍼스의 다리', sell: 12 },
  { id: 360, icon: '4000012', en: "Green Mushroom Cap", ko: '초록버섯의 갓', sell: 14 },
  { id: 361, icon: '4000037', en: "Bubbling's Huge Bubble", ko: '버블링의 큰 방울', sell: 15 },
  { id: 362, icon: '4000018', en: "Firewood", ko: '장작', sell: 17 },
  { id: 363, icon: '4000009', en: "Blue Mushroom Cap", ko: '파란버섯의 갓', sell: 19 },
  { id: 364, icon: '4000042', en: "Stirge Wing", ko: '스티지의 날개', sell: 20 },
  { id: 365, icon: '4000034', en: "Jr. Necki Skin", ko: '주니어 네키의 가죽', sell: 21 },
  { id: 366, icon: '4000015', en: "Horny Mushroom Cap", ko: '뿔버섯의 갓', sell: 22 },
  { id: 367, icon: '4000008', en: "Charm of the Undead", ko: '죽은 자의 부적', sell: 24 },
  { id: 368, icon: '4000020', en: "Wild Boar Tooth", ko: '와일드보어의 송곳니', sell: 25 },
  { id: 369, icon: '4000007', en: "Evil Eye Tail", ko: '이블아이의 꼬리', sell: 27 },
  { id: 370, icon: '4000039', en: "Iron Hog's Metal Hoof", ko: '아이언 호그의 철발굽', sell: 28 },
  { id: 371, icon: '4000068', en: "Fairy's Tentacle", ko: '페어리의 더듬이', sell: 29 },
  { id: 372, icon: '4000032', en: "Ligator Skin", ko: '리게이터의 가죽', sell: 31 },
  { id: 373, icon: '4000024', en: "Fire Boar's Tooth", ko: '파이어보어의 송곳니', sell: 32 },
  { id: 374, icon: '4000013', en: "Curse Eye Tail", ko: '커즈아이의 꼬리', sell: 33 },
  { id: 375, icon: '4000035', en: "Tablecloth", ko: '식탁보', sell: 34 },
  { id: 376, icon: '4000067', en: "Jr. Boogie Horn", ko: '주니어 부기의 뿔', sell: 35 },
  { id: 377, icon: '4000026', en: "Lupin Doll", ko: '루팡 인형', sell: 100 },
  { id: 378, icon: '4000029', en: "Lupin's Banana", ko: '루팡의 바나나', sell: 37 },
  { id: 379, icon: '4000043', en: "Lorang Claw", ko: '로랑의 집게발', sell: 38 },
  { id: 380, icon: '4000031', en: "Cursed Doll", ko: '저주받은 인형', sell: 40 },
  { id: 381, icon: '4000023', en: "Cold Eye Tail", ko: '콜드아이의 꼬리', sell: 41 },
  { id: 382, icon: '4000058', en: "Nependeath Seed", ko: '네펜데스의 씨앗', sell: 42 },
  { id: 383, icon: '4000014', en: "Drake Skull", ko: '드레이크의 머리뼈', sell: 45 },
  { id: 384, icon: '4000045', en: "Tortie Shell", ko: '엄티의 등껍질', sell: 46 },
  { id: 385, icon: '4000062', en: "Dark Nependeath Seed", ko: '다크 네펜데스의 씨앗', sell: 47 },
  { id: 386, icon: '4000036', en: "Medicine With Weird Vibes", ko: '이상한 느낌의 약', sell: 48 },
  { id: 387, icon: '4000044', en: "Clang Claw", ko: '클랑의 집게발', sell: 49 },
  { id: 388, icon: '4000033', en: "Croco Skin", ko: '크로코의 가죽', sell: 52 },
  { id: 389, icon: '4000041', en: "Malady's Experimental Frog", ko: '멜러디의 실험용 개구리', sell: 55 },
  { id: 390, icon: '4000022', en: "Stone Golem Rubble", ko: '스톤골렘의 돌조각', sell: 56 },
  { id: 391, icon: '4000025', en: "Dark Stone Golem Rubble", ko: '다크 스톤골렘의 돌조각', sell: 58 },
  { id: 392, icon: '4000027', en: "Wild Kargo Eye", ko: '와일드카고의 눈동자', sell: 62 },
  { id: 393, icon: '4000028', en: "Tauromacis Horn", ko: '타우로마시스의 뿔', sell: 70 },
  { id: 394, icon: '4000046', en: "Taurospear Horn", ko: '타우로스피어의 뿔', sell: 75 },
  { id: 395, icon: '4000040', en: "Mushmom Spore", ko: '머쉬맘의 포자', sell: 400 },
  { id: 396, icon: '4000021', en: "Leather", ko: '동물의 가죽', sell: 10 },
  { id: 397, icon: '4000030', en: "Dragon Skin", ko: '용의 가죽', sell: 200 },
  { id: 398, icon: 'n4000051', en: "Glowing Mushroom Spore", ko: '빛나는 버섯 포자', tr: true, sell: 39 },
  { id: 399, icon: 'n4000052', en: "Raffle Petal", ko: '라플레 꽃잎', sell: 40 },
  { id: 400, icon: 'n4000053', en: "Golden Stirge Wing", ko: '황금 스티지의 날개', tr: true, sell: 42 },
  { id: 401, icon: 'n4000054', en: "Aqumander Tail", ko: '아쿠아맨더의 꼬리', tr: true, sell: 43 },
  { id: 402, icon: 'n4000055', en: "Echopus Leg", ko: '에코퍼스의 다리', tr: true, sell: 44 },
  { id: 403, icon: 'n4000056', en: "Rafflesia Petal", ko: '라플레시아 꽃잎', tr: true, sell: 47 },
  { id: 404, icon: 'n4000057', en: "Duskmander Tail", ko: '더스크맨더의 꼬리', tr: true, sell: 49 },
  { id: 405, icon: 'n4000058', en: "Giant Tree's Bough", ko: '거대 나무의 가지', tr: true, sell: 51 },
  { id: 406, icon: 'n4000059', en: "Decayed Charm", ko: '썩은 부적', tr: true, sell: 52 },
  { id: 407, icon: 'n4000060', en: "Giant Tree's Rotten Bough", ko: '거대 나무의 썩은 가지', tr: true, sell: 54 },
  { id: 408, icon: '4000136', en: "Coconut", ko: '코코넛 열매', sell: 10 },
  { id: 409, icon: 'n4000062', en: "Animal Fur Bundle", ko: '동물 털 뭉치', tr: true, sell: 10 },
  { id: 410, icon: 'n4000063', en: "Fragment of Magic", ko: '마법의 조각', sell: 10 },
  { id: 411, icon: '4000176', en: "Poisonous Mushroom", ko: '독버섯', sell: 500 },
  { id: 412, icon: 'n4000065', en: "Rotten Mushmom Cap", ko: '썩은 머쉬맘의 갓', tr: true, sell: 600 },
  { id: 5450, icon: '4000195', en: "Seedling", ko: '묘목', sell: 19 },
  { id: 5451, icon: '4000196', en: "Wooden Board", ko: '목판', sell: 23 },
  { id: 5452, icon: '4000197', en: "Slate", ko: '석판', sell: 24 },
  { id: 5453, icon: '4000204', en: "Skeledog's Bone", ko: '스켈독의 뼈', sell: 44 },
  { id: 5454, icon: '4000205', en: "Dirty Bandage", ko: '더러운 붕대', sell: 47 },
  { id: 5455, icon: '4000206', en: "Rib", ko: '갈비뼈', sell: 57 },
  { id: 5456, icon: '4000207', en: "Pelvic Bone", ko: '골반뼈', sell: 63 },
  { id: 5457, icon: '4000208', en: "Horse Skull", ko: '말 머리뼈', sell: 73 },
];
