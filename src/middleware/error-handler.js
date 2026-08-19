function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  if (error.statusCode && error.code) {
    return res.status(error.statusCode).json({
      error: {
        code: error.code,
        message: error.message
      }
    });
  }

  if (process.env.NODE_ENV === 'development') {
    console.error(error.stack || error);
  } else {
    console.error(error.message || 'Unexpected server error');
  }

  return res.status(500).json({
    error: 'Internal Server Error'
  });
}

module.exports = errorHandler;
