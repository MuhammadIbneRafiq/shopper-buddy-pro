
-- ============ ENUMS ============
CREATE TYPE public.app_role AS ENUM ('visually_impaired', 'helper', 'admin');
CREATE TYPE public.request_status AS ENUM ('pending', 'answered', 'dismissed');
CREATE TYPE public.request_kind AS ENUM ('product_check', 'price_check', 'receipt_check', 'general');

-- ============ PROFILES ============
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  phone TEXT,
  preferred_voice TEXT DEFAULT 'default',
  font_scale NUMERIC NOT NULL DEFAULT 1.25,
  high_contrast BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ============ USER ROLES (separate, secure) ============
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

-- ============ JOINT ACCOUNTS ============
CREATE TABLE public.joint_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  helper_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  helper_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(primary_user_id, helper_user_id)
);
ALTER TABLE public.joint_accounts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_helper_of(_helper UUID, _primary UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.joint_accounts WHERE primary_user_id = _primary AND helper_user_id = _helper)
$$;

-- ============ BUDGETS ============
CREATE TABLE public.grocery_budgets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_limit NUMERIC NOT NULL DEFAULT 400,
  currency TEXT NOT NULL DEFAULT 'EUR',
  period_start DATE NOT NULL DEFAULT date_trunc('month', now())::date,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(user_id, period_start)
);
ALTER TABLE public.grocery_budgets ENABLE ROW LEVEL SECURITY;

-- ============ TRANSACTIONS (mock bunq) ============
CREATE TABLE public.transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  merchant TEXT NOT NULL,
  amount NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  category TEXT NOT NULL DEFAULT 'groceries',
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  source TEXT NOT NULL DEFAULT 'bunq_mock',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

-- ============ PRODUCTS (KG nodes) ============
CREATE TABLE public.products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  brand TEXT,
  typical_price NUMERIC,
  currency TEXT NOT NULL DEFAULT 'EUR',
  category TEXT,
  attributes JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.product_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent TEXT NOT NULL,
  child TEXT NOT NULL,
  UNIQUE(parent, child)
);
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  price NUMERIC NOT NULL,
  currency TEXT NOT NULL DEFAULT 'EUR',
  store TEXT,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.price_history ENABLE ROW LEVEL SECURITY;

-- ============ HELPER REQUESTS ============
CREATE TABLE public.helper_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  primary_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  helper_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  kind public.request_kind NOT NULL DEFAULT 'general',
  question TEXT,
  image_url TEXT,
  ai_summary TEXT,
  helper_response TEXT,
  status public.request_status NOT NULL DEFAULT 'pending',
  whatsapp_sent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at TIMESTAMPTZ
);
ALTER TABLE public.helper_requests ENABLE ROW LEVEL SECURITY;

-- ============ RECEIPTS ============
CREATE TABLE public.receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  store TEXT,
  total NUMERIC,
  currency TEXT NOT NULL DEFAULT 'EUR',
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  image_url TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.receipts ENABLE ROW LEVEL SECURITY;

-- ============ POLICIES ============
-- profiles
CREATE POLICY "own profile read" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile insert" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "own profile update" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "helper can read partner profile" ON public.profiles FOR SELECT
  USING (public.is_helper_of(auth.uid(), id));

-- user_roles
CREATE POLICY "read own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own role on signup" ON public.user_roles FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "admin manage roles" ON public.user_roles FOR ALL
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- joint_accounts
CREATE POLICY "members read joint" ON public.joint_accounts FOR SELECT
  USING (auth.uid() = primary_user_id OR auth.uid() = helper_user_id);
CREATE POLICY "primary creates joint" ON public.joint_accounts FOR INSERT
  WITH CHECK (auth.uid() = primary_user_id);
CREATE POLICY "primary deletes joint" ON public.joint_accounts FOR DELETE
  USING (auth.uid() = primary_user_id);

-- grocery_budgets
CREATE POLICY "own budget read" ON public.grocery_budgets FOR SELECT
  USING (auth.uid() = user_id OR public.is_helper_of(auth.uid(), user_id));
CREATE POLICY "own budget write" ON public.grocery_budgets FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- transactions
CREATE POLICY "own tx read" ON public.transactions FOR SELECT
  USING (auth.uid() = user_id OR public.is_helper_of(auth.uid(), user_id));
CREATE POLICY "own tx write" ON public.transactions FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- products + categories + price_history (public read)
CREATE POLICY "products public read" ON public.products FOR SELECT USING (true);
CREATE POLICY "categories public read" ON public.product_categories FOR SELECT USING (true);
CREATE POLICY "price history public read" ON public.price_history FOR SELECT USING (true);

-- helper_requests
CREATE POLICY "primary read own requests" ON public.helper_requests FOR SELECT
  USING (auth.uid() = primary_user_id OR public.is_helper_of(auth.uid(), primary_user_id));
CREATE POLICY "primary insert own requests" ON public.helper_requests FOR INSERT
  WITH CHECK (auth.uid() = primary_user_id);
CREATE POLICY "helper updates request" ON public.helper_requests FOR UPDATE
  USING (public.is_helper_of(auth.uid(), primary_user_id) OR auth.uid() = primary_user_id);

-- receipts
CREATE POLICY "own receipts read" ON public.receipts FOR SELECT
  USING (auth.uid() = user_id OR public.is_helper_of(auth.uid(), user_id));
CREATE POLICY "own receipts write" ON public.receipts FOR ALL
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ============ AUTO PROFILE + DEFAULT ROLE ON SIGNUP ============
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'visually_impaired'));

  INSERT INTO public.grocery_budgets (user_id, monthly_limit)
  VALUES (NEW.id, 400);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER profiles_touch BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER budgets_touch BEFORE UPDATE ON public.grocery_budgets
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ============ SEED KNOWLEDGE GRAPH ============
INSERT INTO public.product_categories (parent, child) VALUES
  ('food', 'dairy'), ('food', 'produce'), ('food', 'bakery'),
  ('food', 'pantry'), ('food', 'beverages'), ('food', 'snacks'),
  ('dairy', 'milk'), ('dairy', 'cheese'), ('dairy', 'yogurt'),
  ('produce', 'fruit'), ('produce', 'vegetables'),
  ('beverages', 'water'), ('beverages', 'juice'), ('beverages', 'coffee')
ON CONFLICT DO NOTHING;

INSERT INTO public.products (name, brand, typical_price, category) VALUES
  ('Whole milk 1L', 'AH', 1.29, 'milk'),
  ('Bananas (1kg)', NULL, 1.69, 'fruit'),
  ('Sourdough loaf', 'Bakery', 3.49, 'bakery'),
  ('Greek yogurt 500g', 'Fage', 2.99, 'yogurt'),
  ('Cheddar 200g', 'Old Amsterdam', 4.50, 'cheese'),
  ('Sparkling water 1.5L', 'Spa', 0.99, 'water'),
  ('Coffee beans 250g', 'Lavazza', 5.99, 'coffee'),
  ('Tomatoes (500g)', NULL, 2.20, 'vegetables')
ON CONFLICT DO NOTHING;
