export const TEXT = {
  ko: {
    other: 'EN',
    title: '볼펜 조립 · 부품 집기 확인',
    lead: '분해한 부품을 흰 종이 위에 펼쳐 놓고 카메라로 비추면, 부품 이름이 자동으로 뜹니다. 순서와 다른 부품을 집으면 바로 알려줍니다.',
    tips: ['흰 A4 종이 위에 부품 5개를 서로 떨어뜨려 놓기', '휴대폰은 종이 전체가 보이게 위에서 비추기', '부품을 종이 가장자리에 걸치지 않기'],
    start: '시작',
    noPaper: '흰 종이 전체가 화면에 들어오게 비춰 주세요',
    setup: '부품을 종이 위에 펼쳐 놓으세요',
    found: '인식된 부품 {n}/5',
    startAnyway: '이대로 시작',
    pick: '{name} 집으세요',
    then: '집은 다음: {action}',
    ok: '맞아요! {name}',
    wrong: '틀렸어요! {got} 집었어요',
    wrongHint: '내려놓고 {want} 집으세요',
    back: '좋아요. 이제 {want} 집으세요',
    done: '완성!',
    doneHint: '그립을 본체에 대고 시계 방향으로 조인 뒤, 레버를 눌러 세 색이 나오는지 써 보세요.',
    restart: '처음부터',
    camErr: '카메라를 켤 수 없습니다. 휴대폰 기본 카메라 앱으로 QR을 찍어 Safari나 Chrome에서 열고, 카메라를 허용해 주세요.',
  },
  en: {
    other: '한국어',
    title: 'Pen assembly · part pick check',
    lead: 'Lay the pen parts on white paper and point the camera at them. Each part is named automatically, and you are told at once if you pick up the wrong one.',
    tips: ['Spread the 5 parts apart on a sheet of white A4 paper', 'Hold the phone above so the whole sheet is in view', 'Keep the parts away from the edge of the sheet'],
    start: 'Start',
    noPaper: 'Fit the whole white sheet in the picture',
    setup: 'Lay the parts out on the paper',
    found: 'Parts found {n}/5',
    startAnyway: 'Start anyway',
    pick: 'Pick up the {name}',
    then: 'Then: {action}',
    ok: 'Right! {name}',
    wrong: 'Wrong part: that is the {got}',
    wrongHint: 'Put it back and pick up the {want}',
    back: 'Good. Now pick up the {want}',
    done: 'Done!',
    doneHint: 'Screw the grip onto the body clockwise, then press each lever and write with all three colours.',
    restart: 'Start over',
    camErr: 'The camera could not start. Scan the QR code with the phone’s camera app, open it in Safari or Chrome and allow the camera.',
  },
};

// name: plain; obj: with Korean object particle (을/를)
export const PARTS = {
  ko: {
    body: { name: '본체', obj: '본체를' },
    black: { name: '검정 리필', obj: '검정 리필을' },
    red: { name: '빨강 리필', obj: '빨강 리필을' },
    blue: { name: '파랑 리필', obj: '파랑 리필을' },
    grip: { name: '그립', obj: '그립을' },
    pen: { name: '완성 볼펜', obj: '완성 볼펜을' },
  },
  en: {
    body: { name: 'body', obj: 'body' }, black: { name: 'black refill', obj: 'black refill' }, red: { name: 'red refill', obj: 'red refill' },
    blue: { name: 'blue refill', obj: 'blue refill' }, grip: { name: 'grip', obj: 'grip' }, pen: { name: 'assembled pen', obj: 'assembled pen' },
  },
};

// what to do with the part after picking it up
export const ACTIONS = {
  ko: {
    body: '레버 3개와 클립이 달린 본체를 들고 앞쪽 구멍이 보이게 잡기',
    black: '검정 레버를 내린 채 본체 앞 구멍에 끝까지 꽂기',
    red: '빨강 레버를 내린 채 본체 앞 구멍에 끝까지 꽂기',
    blue: '파랑 레버를 내린 채 본체 앞 구멍에 끝까지 꽂기',
    grip: '본체 앞쪽에 대고 시계 방향으로 돌려 조이기',
  },
  en: {
    body: 'hold the body (three levers and a clip) with the front opening in view',
    black: 'keep the black lever down and push it fully into the front opening',
    red: 'keep the red lever down and push it fully into the front opening',
    blue: 'keep the blue lever down and push it fully into the front opening',
    grip: 'put it on the front of the body and turn clockwise until tight',
  },
};

export const COLORS = { body: '#7b8794', black: '#f4f7fb', red: '#ff5a5f', blue: '#4c8dff', grip: '#c3cad3', pen: '#a3acb7' };
export function fmt(s, v = {}) { return String(s).replace(/\{(\w+)\}/g, (_, k) => (k in v ? v[k] : '')); }
