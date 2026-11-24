/**
 * `<braccato-lyrics>` is a custom element registered at runtime by
 * @braccato/core/element. Declaring it here lets JSX accept the tag.
 *
 * React 19 resolves intrinsic elements through `React.JSX`, so the declaration
 * has to live there rather than on the global JSX namespace.
 */
import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "braccato-lyrics": DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & { ref?: Ref<HTMLElement> };
    }
  }
}
