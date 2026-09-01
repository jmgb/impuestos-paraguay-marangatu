# Portal discovery notes

Initial exploration: 2026-05-09. Last functional update: 2026-09-01.

All names, identifiers, and tax values are replaced with placeholders. Real checkpoints must never be committed or published.

## Marangatu login

Observed accessible controls:

```text
textbox "Usuario"
textbox "Contraseña"
button "Acceder"
```

The authenticated home page includes account information and recent filing periods. These values are sensitive and must not be logged.

## Form 120

The `Presentar Declaracion` shortcut has a session-dependent internal link similar to:

```text
recibirDDJJContribuyente.do?_cyp=...
```

The token changes on every session, so the script reads the current link from the DOM instead of persisting it.

Observed form controls:

```text
heading "Presentar Declaración"
pre-filled tax identifier and verification digit
option "211 - IVA General - MENSUAL"
monthly period
year selector
month selector
button "Abrir Declaración"
```

After real submission, the workflow opens `Consultar Declaraciones`, filters the exact form and period, and requires an active terminal row.

## Form 241

Observed menu route:

```text
Declaraciones Informativas
Gestion De Comprobantes Informativos
```

The menu item may not expose a stable `href`. The script attempts to discover the dynamic route from the HTML or Angular menu model and falls back to clicking the visible card.

The dynamic route resembles:

```text
gestionComprobantesVirtuales.do?_cyp=...
```

The `Confirmar Presentación` card opens a page resembling:

```text
gdi/presentacionTalonResumen.do?_cyp=...
```

Observed period controls:

```html
<select name="anho">...</select>
<select name="mes">...</select>
```

When no slips are pending, the portal displays:

```text
No existen talones pendientes de presentación
```

If slips are pending, dry-run confirms that the final button exists without clicking it. Authorized real submission clicks `Presentar declaración`, accepts the dialog, and reopens the same period. Success requires the portal to report that no pending slips remain.

## Final verification

Form 120 requires a matching form and period, active flag, and accepted terminal status in `Consultar Declaraciones`. Form 241 uses the independent pending-slip check. Both gates run before success notifications.
