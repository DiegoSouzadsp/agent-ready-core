# ARS Playground

Editor web (Svelte + Vite + Monaco) para experimentar schemas Agent-Ready (ARS) em YAML.
A cada edição, o conteúdo é carregado com `AgentReady.fromYAML` de `@agent-ready/core`
e o painel ao lado mostra se o schema é válido, o módulo e as operações encontradas.

## Rodar

```bash
npm install          # na raiz do monorepo
cd apps/playground
npm run dev
```

`npm run build` gera o bundle estático; `npm run check` roda svelte-check.
