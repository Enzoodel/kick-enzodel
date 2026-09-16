# Kick Enzodel — Gestión de plataformas

Panel para manejar plataformas: cuentas, depósitos (FTD), redepósitos y totales en USD, con acceso para vos (admin) y tus moderadores.

## Uso local

```bash
npm install
npm start
```

Abrí http://localhost:3000 — usuario `admin` (la clave la gestionás en Ajustes → Equipo).
En local guarda todo en `data.sqlite` (no se sube a git).

## Subir a GitHub + Vercel (para tus moderadores)

1. **GitHub:** subí este proyecto a un repo (ver pasos abajo).
2. **Vercel:** [vercel.com](https://vercel.com) → Add New → Project → importá el repo.
3. **Base de datos:** en el proyecto de Vercel → Storage → Create → Postgres.
   - Vercel crea las variables `POSTGRES_URL`, etc. Agregá una variable `DATABASE_URL` con el mismo valor de `POSTGRES_URL` (o conectá el storage, que las inyecta).
4. **Variables de entorno** (Settings → Environment Variables):
   - `JWT_SECRET` = una frase larga y secreta
   - `ADMIN_USER` = tu usuario admin
   - `ADMIN_PASS` = tu contraseña admin
   - `DATABASE_URL` = la de Postgres
5. **Deploy.** La primera vez se crea el admin y la plataforma Enzodel solos.
6. Pasale la URL a tus moderadores. Creales usuario en **Ajustes → Equipo**.

> En Vercel los datos viven en Postgres (persisten). En local siguen en SQLite.
