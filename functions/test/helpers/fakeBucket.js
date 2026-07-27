function makeFakeBucket() {
  const saved = [];
  const deleted = [];
  const bucket = {
    name: 'fake-bucket',
    saved,
    deleted,
    failNextDelete: false,
    file(path) {
      return {
        async save(buffer, opts) {
          saved.push({ path, buffer, opts });
        },
        async getSignedUrl(options) {
          return [`https://storage.fake/${path}?expires=${options.expires}`];
        },
        async delete() {
          if (bucket.failNextDelete) {
            bucket.failNextDelete = false;
            throw new Error('storage unavailable');
          }
          deleted.push(path);
        },
        publicUrl() {
          return `https://storage.fake/${path}`;
        },
      };
    },
  };
  return bucket;
}

module.exports = { makeFakeBucket };
