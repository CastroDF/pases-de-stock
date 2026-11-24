# Pases de stock

Versión académica simplificada del flujo de pases de stock de OECE Logistics, una aplicación real. Esta implementación se hizo para el entregable de Metodologías de Desarrollo Web. El código es independiente y todos los datos son ficticios.

La aplicación registra el cambio de titular de un lote. Descuenta kilos al origen, los suma al destino y conserva el total físico en el mismo depósito.

[Demo pública](https://pases-de-stock-academico.super-unit-5dba.workers.dev/) · [Requisito y casos de aceptación](docs/requisitos.md)

## Ejecutar y probar

Requiere Node.js 22.13 o posterior. No hay dependencias que instalar.

```sh
npm test
SESSION_SECRET="$(openssl rand -hex 32)" \
  DEMO_OPERATOR_PASSWORD='operador-local' \
  DEMO_SUPERVISOR_PASSWORD='supervisor-local' npm run dev
```

Abrí [el panel local](http://127.0.0.1:4123). Usá `operador` para consultar y confirmar un pase, o `supervisor` para consultar y administrar los motivos de pase. El servidor usa SQLite local y el mismo código de aplicación que el Worker. Las dos cuentas ven el mismo stock ficticio con permisos distintos.

El flujo principal va desde la consulta de disponibilidad hasta el pase confirmado, con egreso e ingreso en un mismo depósito. Supervisión administra el catálogo de motivos y consulta el pase en el historial. El lote y su titular forman una relación muchos a muchos por `opening_balances`. Un pase tiene dos movimientos y un motivo puede estar asociado a varios pases.

`GET /api/passes/availability` recibe `lot`, `origin` y `kilos`. Devuelve `available` con 200, `INVALID_INPUT` con 400, `UNKNOWN_LOT` con 404 e `INSUFFICIENT_STOCK` con 409. Es una consulta. El registro del pase vuelve a comprobar el saldo en la base en el momento de escribir.

## Arquitectura

- Panel HTML, CSS y JavaScript. Consulta stock, confirma pases y muestra el historial.
- API JSON en Cloudflare Workers. Verifica el rol con una cookie de sesión firmada, valida datos y permite reintentar una confirmación sin duplicarla.
- Cloudflare D1. Las migraciones crean los lotes y los motivos de ejemplo. La base asegura que el egreso y el ingreso se registren juntos y que el saldo no quede negativo.
- Nager.Date informa el próximo día hábil de revisión. OpenStreetMap muestra la ubicación ilustrativa del depósito cuando se abre el mapa. Ambos son complementarios al pase.

`npm run build` genera en `dist/` los módulos del Worker y los tres archivos del panel como recursos embebidos. En una D1 nueva aplicá ambas migraciones en orden y configurá el binding `DB`. Al actualizar una D1 que ya tiene la primera migración, aplicá solo `0002_pass_reasons.sql`. Cargá los módulos con `site.mjs` como entrada. Configurá `SESSION_SECRET` (32 caracteres o más), `DEMO_OPERATOR_PASSWORD` y `DEMO_SUPERVISOR_PASSWORD` como secretos de Cloudflare. Usá contraseñas de prueba distintas de las locales. La integración continua de GitHub ejecuta `npm test` en cada push y pull request. La publicación en Cloudflare es manual.
