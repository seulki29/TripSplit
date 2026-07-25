function makeFakeBucket() {
  const saved = [];
  return {
    saved,
    file(path) {
      return {
        async save(buffer, opts) {
          saved.push({ path, buffer, opts });
        },
        publicUrl() {
          return `https://storage.fake/${path}`;
        },
      };
    },
  };
}

module.exports = { makeFakeBucket };
