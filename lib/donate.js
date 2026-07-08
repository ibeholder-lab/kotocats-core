module.exports = {
  successUrl(pageUrl) {
    return pageUrl + "?payment=success&kind=donate";
  },

  failureUrl(pageUrl) {
    return pageUrl + "?payment=failed&kind=donate";
  },
};
