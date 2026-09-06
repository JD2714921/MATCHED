// TypeScript 6 does not resolve side-effect CSS imports on its own; Next's own
// `next-env.d.ts` no longer supplies this under the TS6 resolver, so declare the
// module shapes we import for their side effects here.
declare module "*.css";
declare module "*.scss";
declare module "*.svg" {
  const content: string;
  export default content;
}
