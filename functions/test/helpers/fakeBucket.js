function makeFakeBucket() {
  const saved = [];
  return {
    saved,
    file(path) {
      return {
        async save(buffer, opts) {
          saved.push({ path, buffer, opts });
        },
        async getSignedUrl(options) {
          return [`https://storage.fake/${path}?expires=${options.expires}`];
        },
        publicUrl() {
          return `https://storage.fake/${path}`;
        },
      };
    },
  };
}

module.exports = { makeFakeBucket };
