const MESSAGES = {
  UNAUTHENTICATED: '세션이 만료되었습니다. 다시 로그인해주세요.',
  SESSION_EXPIRED: '세션이 만료되었습니다. 다시 로그인해주세요.',
  PERMISSION_DENIED: '권한이 없습니다.',
  RATE_LIMITED: '요청이 너무 잦습니다. 잠시 후 다시 시도해주세요.',
  INVALID_PASSWORD: '비밀번호가 올바르지 않습니다.',
  INVALID_PIN: 'PIN이 올바르지 않습니다.',
  TOO_MANY_ATTEMPTS: '시도가 너무 많습니다. 잠시 후 다시 시도해주세요.',
  MISSING_FIELDS: '필수 항목을 모두 입력해주세요.',
  SLUG_TAKEN: '이미 사용 중인 URL(slug)입니다.',
  NAME_REQUIRED: '이름을 입력해주세요.',
  NAME_TAKEN: '이미 있는 이름입니다.',
  INVALID_WEIGHT: '가중치는 0 이상의 숫자여야 합니다.',
  INVALID_AMOUNT: '금액은 0보다 큰 숫자여야 합니다.',
  INVALID_CATEGORY: '카테고리가 올바르지 않습니다.',
  INVALID_EXCLUDED_MEMBERS: '제외 구성원 선택이 올바르지 않습니다.',
  INVALID_PHOTO_PATH: '사진 정보가 올바르지 않습니다.',
  INVALID_MIME_TYPE: '지원하지 않는 이미지 형식입니다. (JPG/PNG만 가능)',
  INVALID_STATUS: '상태 값이 올바르지 않습니다.',
  MEMBER_NOT_FOUND: '구성원을 찾을 수 없습니다.',
  EXPENSE_NOT_FOUND: '경비 항목을 찾을 수 없습니다.',
  TRIP_NOT_FOUND: '여행을 찾을 수 없습니다.',
  NO_PHOTO: '첨부된 영수증이 없습니다.',
  EXPENSE_LOCKED: '확정된 항목은 수정할 수 없습니다.',
  ENTERED_BY_REQUIRED: '입력 귀속 대상을 선택해주세요.',
  FORBIDDEN: '권한이 없습니다.',
  INTERNAL_ERROR: '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.',
};

const FALLBACK = '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';

function errorMessageFor(code) {
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code] : FALLBACK;
}

export { errorMessageFor, MESSAGES, FALLBACK };
