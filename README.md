# 모아 · 개인 가계부

HTML/CSS/JavaScript + Node.js/Express + Neon PostgreSQL로 만든 한국어 개인 가계부입니다. 실제 데이터는 Neon에만 저장합니다. SQLite 및 localStorage는 사용하지 않습니다.

## 로컬 실행

Node.js 22 이상이 필요합니다.

```sh
npm install
cp .env.example .env
```

`.env`를 편집해 아래 두 값을 입력하세요. 비밀값을 소스 코드나 채팅에 붙여 넣지 마세요.

- `DATABASE_URL`: Neon 프로젝트의 Connect 화면에서 복사한 PostgreSQL 연결 문자열 (`sslmode=require` 포함).
- `APP_PASSWORD`: 가계부 로그인용 비밀번호. 최소 12자이며 길고 추측하기 어려운 값을 사용하세요.
- `PORT`: 선택값, 기본 `3000`.

```sh
npm run dev
```

http://localhost:3000 에 접속하세요. 일반 실행은 `npm start`입니다. 환경변수가 없어도 화면과 서버는 실행되며, 로그인에는 설정 안내가 표시됩니다. 임시 저장소로 대체하지 않습니다.

최초 로그인 시 `expenses`, 날짜 인덱스, `login_limits` 테이블을 자동으로 생성합니다. Neon DB 계정에 테이블/인덱스 생성 권한이 필요합니다. 기존의 같은 이름 테이블이 있다면 별도 데이터베이스 또는 브랜치를 사용하세요.

## 사용법

- 지출 기록하기: 날짜, 항목, 카테고리, 금액을 입력합니다. 원화 정수만 지원합니다.
- 월 선택: 좌우 화살표 또는 연월 선택기로 조회합니다.
- 날짜 검색: 날짜를 고르면 해당 날짜의 내역만 표시합니다. 다른 달 날짜는 조회 월도 함께 변경합니다.
- 월별 카드와 카테고리 그래프: 날짜 검색과 관계없이 선택한 달 전체를 집계합니다. 목록 하단에는 검색 결과 합계가 별도로 표시됩니다.
- 목록 오른쪽 연필/삭제 버튼으로 수정하거나 확인 후 삭제합니다.
- 모바일 화면 및 키보드 사용을 지원합니다.

## GitHub + Vercel 배포

1. GitHub에 새 저장소를 만들고 프로젝트 파일을 올립니다. `.env`는 `.gitignore`에 포함되어 있으므로 커밋하지 마세요. `node_modules`도 제외합니다.
2. Vercel에서 **Add New → Project**로 해당 GitHub 저장소를 가져옵니다.
3. Framework Preset은 **Express**, Root Directory는 프로젝트 루트로 선택합니다. 별도 프런트엔드 빌드나 Output Directory는 필요하지 않습니다. Node.js는 22 이상을 선택하세요.
4. Vercel 프로젝트의 **Settings → Environment Variables**에 `DATABASE_URL`, `APP_PASSWORD`를 등록합니다. Production/Preview 중 사용할 환경에 각각 설정하세요. Preview가 실제 데이터를 수정하지 않게 별도 Neon 브랜치 연결을 권장합니다.
5. Deploy를 실행합니다. 이미 배포했다면 환경변수 변경 후 Redeploy가 필요합니다.
6. 배포 주소에서 로그인한 뒤 지출 추가/수정/삭제와 집계를 확인하세요. 이후 GitHub 푸시로 자동 배포됩니다.

Vercel은 루트 `server.js`의 기본 Express export를 실행하며 `public/` 정적 파일은 CDN에서 제공합니다. [Vercel Express 공식 문서](https://vercel.com/docs/frameworks/backend/express), [Neon 서버리스 드라이버](https://neon.com/docs/serverless/serverless-driver).

## 보안 및 운영

- 연결 문자열과 비밀번호는 서버 환경변수에서만 읽습니다. 정적 공개 폴더는 `public/`뿐입니다.
- Neon HTTP 드라이버의 매개변수 SQL을 사용합니다. 사용자 입력을 HTML로 삽입하지 않습니다.
- 모든 지출/통계 API에 인증을 적용합니다. 비밀번호는 해시를 일정 시간 비교하며 서버 로그에 요청·DB 오류·비밀값을 출력하지 않습니다.
- 인증 쿠키는 HttpOnly, SameSite=Strict이며 Vercel/production에서 Secure를 사용합니다. 12시간 후 만료됩니다. APP_PASSWORD 변경 시 기존 세션도 무효화됩니다.
- 로그아웃은 현재 브라우저 쿠키를 제거합니다. 이미 복사된 쿠키를 개별 폐기하는 세션 저장 기능은 없으며, 전체 무효화에는 APP_PASSWORD 변경이 필요합니다.
- 로그인은 IP별 15분당 10회로 제한합니다. 제한 카운터는 Neon에 저장되어 Vercel 인스턴스 간 공유됩니다. 성공한 로그인도 시도 횟수에 포함됩니다.
- 수정 API는 JSON 및 전용 헤더를 요구하고 cross-site 요청을 거절합니다. Helmet 보안 헤더와 CSP를 적용합니다.
- 개인용 단일 비밀번호 앱입니다. 계정 분리 기능은 없으며 비밀번호를 공유하면 같은 가계부에 접근합니다.
- production 쿠키는 HTTPS가 필요합니다. 로컬 HTTP 개발 시 NODE_ENV=production을 사용하지 마세요.

## 검증

```sh
npm test
```

테스트 전용 저장소를 주입해 HTTP 인증, CRUD, 날짜 필터, 월 합계, 검증, CSRF, 세션 변조/만료, 로그인 제한, 비밀 파일 차단, DB 오류 메시지를 검사합니다. 프로덕션에 대체 저장소는 없습니다. 실제 Neon 연결 및 Vercel 배포 검증에는 사용자 환경변수와 계정 연결이 필요합니다.
