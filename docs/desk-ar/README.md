# 교실 책상 AR 조립 안내 (학생 프로젝트 데모)

QR 코드를 휴대폰으로 찍으면 이 페이지가 열리고, 휴대폰 카메라가 켜집니다.
**같은 QR 코드를 카메라로 다시 비추면 QR 위에 3D 책상이 나타나** 조립 순서를 10단계로 보여줍니다.
QR 코드가 링크이자 AR 기준점(마커) 역할을 함께 합니다.

- 주소: https://wnsdudc.github.io/freellmapi/desk-ar/
- 앱 설치 없음. iPhone(Safari), Android(Chrome) 모두 같은 방식(카메라 영상 + QR 추적)으로 동작
- 제품은 가상의 데모 제품(DEMO-DESK-01, 65×45×72 cm)이며 실제 제조사의 설명서가 아닙니다.

## 파일
| 파일 | 역할 |
|---|---|
| `index.html` | 화면 |
| `app.js` | 카메라, QR 추적, 3D 표시, 단계 진행 |
| `detector.js` | 카메라 프레임에서 QR 네 모서리를 찾는 워커 (jsQR) |
| `desk.js` | 책상 3D 모델과 조립 단계 |
| `text.js` | 화면 문구 (한국어·영어) |
| `vendor/` | three.js r160 (MIT), jsQR 1.4.0 (Apache-2.0) |

## 주소 옵션
- `?lang=en` 영어 화면, `?step=5` 5단계부터 시작, `?mode=viewer` 카메라 없이 3D 보기
- `?focal=0.75` 카메라 화각을 고정(기본은 QR 모양으로 자동 추정)
