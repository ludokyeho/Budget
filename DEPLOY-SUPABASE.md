# Budget - déploiement synchronisé

## 1. Créer le projet Supabase

1. Va sur https://supabase.com et crée un projet.
2. Ouvre `SQL Editor`.
3. Copie-colle le contenu de `supabase-schema.sql`.
4. Lance le script.

## 2. Créer les comptes

Option simple :

1. Dans l'app, utilise `Créer un compte` pour Ludo.
2. Recommence pour Alix.
3. Dans Supabase, va dans `Authentication > Providers > Email`.
4. Désactive ensuite les inscriptions si tu veux que seuls vos deux comptes puissent accéder à l'app.

## 3. Renseigner la config

La config est déjà remplie avec le projet Supabase que tu as donné :

```js
window.BUDGET_SUPABASE = {
  url: "https://dinpdzpldtvgcwbgwhmc.supabase.co",
  publishableKey: "sb_publishable_yYyVviHXr1QAfSYl-znKrA_TXJvVFb7",
};
```

Le prompt Supabase qui installe `@supabase/supabase-js` et `@supabase/ssr` est prévu pour une app Next.js avec rendu serveur. Cette app Budget est statique pour l'instant, donc elle utilise directement l'API Supabase depuis le navigateur avec la clé publishable.

## 4. Déployer

L'app est statique. Sur Netlify ou Vercel :

- build command : vide
- publish directory : `.`

Sur GitHub Pages :

- `Settings > Pages`
- source : `Deploy from a branch`
- branch : `main`
- folder : `/ root`

## 5. Installer sur téléphone

1. Ouvre l'URL déployée dans Safari ou Chrome.
2. Utilise `Ajouter à l'écran d'accueil`.
3. Connecte-toi.
4. Crée le code PIN local sur chaque téléphone.
