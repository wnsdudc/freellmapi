export const TEXT = {
  ko: {
    other: 'EN',
    title: '볼펜 조립 · 부품 집기 확인',
    lead: '분해한 부품을 밝은 책상이나 흰 종이 위에 펼쳐 놓고 카메라로 비추면, 부품 이름이 자동으로 뜹니다. 순서와 다른 부품을 집으면 바로 알려줍니다.',
    tips: ['밝은 단색 책상(또는 흰 종이) 위에 부품 5개를 서로 떨어뜨려 놓기', '휴대폰은 부품이 모두 보이게 위에서 비추기', '부품끼리 겹치거나 화면 가장자리에 걸치지 않게 하기'],
    start: '시작',
    noSurface: '밝은 책상이나 흰 종이가 보이게 비춰 주세요',
    setup: '부품 5개를 펼쳐 놓고 비춰 주세요',
    found: '인식된 부품 {n}/5',
    startAnyway: '이대로 시작',
    pick: '{name} 집으세요',
    then: '집은 다음: {action}',
    ok: '맞아요! {name}',
    wrong: '틀렸어요! {got} 집었어요',
    wrongHint: '내려놓고 {want} 집으세요',
    back: '좋아요. 이제 {want} 집으세요',
    done: '완성!',
    doneHint: '볼펜 하단을 상단에 대고 시계 방향으로 조인 뒤, 레버를 눌러 세 색이 나오는지 써 보세요.',
    restart: '처음부터',
    camErr: '카메라를 켤 수 없습니다. 휴대폰 기본 카메라 앱으로 QR을 찍어 Safari나 Chrome에서 열고, 카메라를 허용해 주세요.',
  },
  en: {
    other: '한국어',
    title: 'Pen assembly · part pick check',
    lead: 'Lay the pen parts on a light desk or white paper and point the camera at them. Each part is named automatically, and you are told at once if you pick up the wrong one.',
    tips: ['Spread the 5 parts apart on a light, plain desk (or white paper)', 'Hold the phone above so all parts are in view', 'Keep parts apart and away from the edge of the picture'],
    start: 'Start',
    noSurface: 'Point the camera at a light desk or white paper',
    setup: 'Lay out the 5 parts and point the camera at them',
    found: 'Parts found {n}/5',
    startAnyway: 'Start anyway',
    pick: 'Pick up the {name}',
    then: 'Then: {action}',
    ok: 'Right! {name}',
    wrong: 'Wrong part: that is the {got}',
    wrongHint: 'Put it back and pick up the {want}',
    back: 'Good. Now pick up the {want}',
    done: 'Done!',
    doneHint: 'Screw the lower part onto the upper part clockwise, then press each lever and write with all three colours.',
    restart: 'Start over',
    camErr: 'The camera could not start. Scan the QR code with the phone’s camera app, open it in Safari or Chrome and allow the camera.',
  },
};

// name: plain; obj: with Korean object particle (을/를)
export const PARTS = {
  ko: {
    body: { name: '볼펜 상단', obj: '볼펜 상단을' },
    black: { name: '검정 리필', obj: '검정 리필을' },
    red: { name: '빨강 리필', obj: '빨강 리필을' },
    blue: { name: '파랑 리필', obj: '파랑 리필을' },
    grip: { name: '볼펜 하단', obj: '볼펜 하단을' },
    pen: { name: '완성 볼펜', obj: '완성 볼펜을' },
  },
  en: {
    body: { name: 'upper part', obj: 'upper part' }, black: { name: 'black refill', obj: 'black refill' }, red: { name: 'red refill', obj: 'red refill' },
    blue: { name: 'blue refill', obj: 'blue refill' }, grip: { name: 'lower part', obj: 'lower part' }, pen: { name: 'assembled pen', obj: 'assembled pen' },
  },
};

// what to do with the part after picking it up
export const ACTIONS = {
  ko: {
    body: '레버와 클립이 있는 볼펜 상단을 들고 앞쪽 구멍이 보이게 잡기',
    black: '검정 레버를 내린 채 볼펜 상단 앞 구멍에 끝까지 꽂기',
    red: '빨강 레버를 내린 채 볼펜 상단 앞 구멍에 끝까지 꽂기',
    blue: '파랑 레버를 내린 채 볼펜 상단 앞 구멍에 끝까지 꽂기',
    grip: '볼펜 상단 앞쪽에 대고 시계 방향으로 돌려 조이기',
  },
  en: {
    body: 'hold the upper part (levers and clip) with the front opening in view',
    black: 'keep the black lever down and push it fully into the upper part’s front opening',
    red: 'keep the red lever down and push it fully into the front opening',
    blue: 'keep the blue lever down and push it fully into the front opening',
    grip: 'put it on the front of the upper part and turn clockwise until tight',
  },
};

export const COLORS = { body: '#7b8794', black: '#f4f7fb', red: '#ff5a5f', blue: '#4c8dff', grip: '#c3cad3', pen: '#a3acb7' };
export function fmt(s, v = {}) { return String(s).replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : '')); }
