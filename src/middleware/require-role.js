const AppError = require('../utils/app-error');

function requireRole(roles) {
  const allowedRoles = (Array.isArray(roles) ? roles : [roles]).map(
    (role) => String(role).toUpperCase()
  );

  return function validatePersonaRole(req, res, next) {
    if (!req.persona) {
      return next(
        new AppError(
          500,
          'PERSONA_CONTEXT_MISSING',
          'Fleet Management persona context is unavailable.'
        )
      );
    }

    if (!allowedRoles.includes(req.persona.role)) {
      return next(
        new AppError(
          403,
          'ROLE_NOT_ALLOWED',
          'This operation is not available for the current Fleet Management persona.'
        )
      );
    }

    return next();
  };
}

module.exports = requireRole;
