import { escapeHtml } from './ui.js';

const CATEGORIES = ['숙박', '식비', '장보기', '교통비', '놀이', '기타'];

// Slot ORDER is the colourblind-safety mechanism, not decoration: this sequence
// was validated (adjacent-pair CVD dE 9.1, normal-vision dE 19.6) against the
// #fafaf8 page surface. Re-run the dataviz validator before reordering or adding.
const CATEGORY_META = {
  숙박: { slug: 'lodging', mark: '#2a78d6' },
  식비: { slug: 'food', mark: '#eb6834' },
  장보기: { slug: 'grocery', mark: '#1baf7a' },
  교통비: { slug: 'transport', mark: '#eda100' },
  놀이: { slug: 'play', mark: '#e87ba4' },
  기타: { slug: 'etc', mark: '#4a3aa7' },
};

// Older trips may hold a category no longer in the list; render it, don't crash.
function categoryMeta(category) {
  return CATEGORY_META[category] || CATEGORY_META['기타'];
}

function categorySlug(category) {
  return categoryMeta(category).slug;
}

function categoryMark(category) {
  return categoryMeta(category).mark;
}

function categoryTag(category) {
  return `<span class="tag" data-cat="${categorySlug(category)}">${escapeHtml(category)}</span>`;
}

function categoryDot(category) {
  return `<span class="cat-dot" style="background:${categoryMark(category)}"></span>`;
}

export {
  CATEGORIES, categorySlug, categoryMark, categoryTag, categoryDot,
};
