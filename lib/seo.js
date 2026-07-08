module.exports = {
  buildCatTitle(cat) {
    return `${cat.name} ищет дом`;
  },

  buildCatDescription(cat) {
    return (
      cat.description ||
      cat.shortDescription ||
      `Познакомьтесь с кошкой ${cat.name}.`
    );
  },
};
