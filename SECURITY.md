# Seguridad

Este proyecto procesa credenciales y evidencia fiscal sensible. No abras una issue pública que contenga usuario, contraseña, RUC, DV, tokens, cookies, URLs de sesión, capturas, HTML del portal ni justificantes.

## Informar de una vulnerabilidad

Utiliza la opción privada **Report a vulnerability** de la pestaña Security del repositorio. Incluye únicamente los pasos mínimos para reproducirla y redacta cualquier dato fiscal o credencial.

Si una credencial o token llegó a Git, revócalo o rótalo inmediatamente. Borrarlo en un commit posterior no lo elimina del historial.

## Límites

- No intentes superar CAPTCHA, MFA ni controles de acceso.
- No pruebes el flujo con cuentas ajenas o sin autorización.
- No ejecutes presentaciones reales para reproducir un problema.
- Usa mocks para los tests automatizados y dry-run para validar cambios del portal.
