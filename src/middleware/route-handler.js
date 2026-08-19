function routeHandler(handler) {
  return function handledRoute(req, res, next) {
    try {
      const result = handler(req, res, next);

      if (result && typeof result.catch === 'function') {
        return result.catch(next);
      }

      return result;
    } catch (error) {
      return next(error);
    }
  };
}

module.exports = routeHandler;
