# Mantenimiento pendiente

La automatización cubre F120, F241, dry-run seguro, presentación real supervisada, verificación posterior, estado local y notificaciones opcionales.

## Operación mensual

1. Ejecutar el dry-run programado del mes anterior.
2. Revisar checkpoints y cualquier cambio visual del portal.
3. Autorizar por separado una presentación real, si corresponde.
4. Confirmar F120 en `Consultar Declaraciones` y F241 sin talones pendientes.
5. Conservar los justificantes y limpiar los artifacts de depuración cuando ya no sean necesarios.

## Mantenimiento técnico

- Actualizar Playwright de forma controlada y repetir los tests más un dry-run visible.
- Revisar selectores después de cualquier cambio de Marangatu.
- Mantener las variables nuevas sincronizadas con `.env.example` y README.
- No añadir capturas, HTML, justificantes, credenciales ni URLs de sesión a Git.
- Mantener la automatización recurrente exclusivamente en modo dry-run.

## Comandos

```bash
npm test
npm run dry-run
npm run submit -- --confirm-period YYYY-MM --check
npm run submit -- --confirm-period YYYY-MM
```
