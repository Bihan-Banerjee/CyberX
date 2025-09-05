import React from 'react';
import { motion } from 'motion/react';
import { spring } from 'motion'; // generator, not the string "spring"

const transition = {
  type: spring,
  stiffness: 100,
  damping: 11.5,
  mass: 0.5,
  restDelta: 0.001,
  restSpeed: 0.001,
};

export const MenuItem = ({
  setActive,
  active,
  item,
  children,
}: {
  setActive: (item: string | null) => void;   // allow closing to null
  active: string | null;
  item: string;
  children?: React.ReactNode;
}) => {
  return (
    <div
      onMouseEnter={() => setActive(item)}
      className="relative inline-flex flex-col items-center"
    >
      <motion.p transition={{ duration: 0.3 }}
        className="cursor-pointer text-white hover:text-cyan-400 font-medium">
        {item}
      </motion.p>

      {active === item && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={transition}
          className="absolute top-full mt-3 left-1/2 -translate-x-1/2 z-50 pointer-events-auto"
          onMouseLeave={() => setActive(null)}   // close when leaving the popover
        >
          <motion.div
            layoutId={`popover-${item}`} // unique per item avoids cross-item FLIP jumps
            className="min-w-56 max-w-[720px] max-h-[70vh] overflow-auto
                       bg-black/70 backdrop-blur-xl rounded-2xl
                       border border-white/20 shadow-xl"
          >
            <motion.div layout className="w-max p-4"> {/* note: no h-full */}
              {children}
            </motion.div>
          </motion.div>
        </motion.div>
      )}
    </div>
  );
};

export const Menu = ({
  setActive,
  children,
}: {
  setActive: (item: string | null) => void;
  children: React.ReactNode;
}) => {
  return (
    <nav
      onMouseLeave={() => setActive(null)}
      className="fixed top-0 left-0 right-0 z-40 flex items-center justify-center
                 gap-10 px-8 py-4 bg-black/40 backdrop-blur-lg
                 border-b border-white/10 shadow-lg"
    >
      <div className="flex items-center justify-center gap-8">
        {children}
      </div>
    </nav>
  );
};

export const ProductItem = ({
  title, description, href, src,
}: { title: string; description: string; href: string; src: string; }) => (
  <a href={href} className="flex space-x-2">
    <img src={src} width={140} height={70} alt={title} className="shrink-0 rounded-md shadow-2xl" />
    <div>
      <h4 className="text-xl font-bold mb-1 text-white">{title}</h4>
      <p className="text-neutral-300 text-sm max-w-[10rem]">{description}</p>
    </div>
  </a>
);

export const HoveredLink = (
  props: React.AnchorHTMLAttributes<HTMLAnchorElement>
) => {
  const { children, className = '', ...rest } = props;
  return (
    <a {...rest} className={`text-neutral-200 hover:text-white ${className}`}>
      {children}
    </a>
  );
};
