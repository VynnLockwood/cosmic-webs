--
-- PostgreSQL database dump
--

\restrict lV1QXYAEZoUXv9PS1JIqISohFkFqwIvhQOwTgf3BcQs2BBwgzsXpC1bdBUVXE3f

-- Dumped from database version 16.11
-- Dumped by pg_dump version 18.6

SET statement_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SELECT pg_catalog.set_config('search_path', '', false);
SET default_table_access_method = heap;

CREATE TABLE public."Partner" (
    "partnerID" uuid NOT NULL,
    "fullName" text,
    moo character varying(5),
    latitude double precision,
    "isDelete" boolean,
    "createdDate" timestamp with time zone
);

ALTER TABLE public."Partner" OWNER TO some_owner;

COMMENT ON TABLE public."Partner" IS 'ข้อมูลคู่ค้า';
COMMENT ON COLUMN public."Partner"."partnerID" IS 'รหัส';

CREATE SEQUENCE public.address_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;

ALTER SEQUENCE public.address_seq OWNER TO some_owner;

CREATE TABLE public."PartnerAddress" (
    id integer NOT NULL,
    "partnerID" uuid,
    street character varying(255)
);

ALTER TABLE public."PartnerAddress" OWNER TO some_owner;
ALTER TABLE ONLY public."PartnerAddress" ALTER COLUMN id SET DEFAULT nextval('public.address_seq'::regclass);

COPY public."Partner" ("partnerID", "fullName", moo, latitude, "isDelete", "createdDate") FROM stdin;
11111111-1111-1111-1111-111111111111	ACME \N	1	13.7	f	2026-01-01 00:00:00+00
\.

ALTER TABLE ONLY public."Partner"
    ADD CONSTRAINT "Partner_pkey" PRIMARY KEY ("partnerID");

ALTER TABLE ONLY public."PartnerAddress"
    ADD CONSTRAINT "PartnerAddress_pkey" PRIMARY KEY (id);

ALTER TABLE ONLY public."PartnerAddress"
    ADD CONSTRAINT "PartnerAddress_partner_fkey" FOREIGN KEY ("partnerID") REFERENCES public."Partner"("partnerID");

GRANT SELECT ON TABLE public."Partner" TO PUBLIC;

--
-- PostgreSQL database dump complete
--

\unrestrict lV1QXYAEZoUXv9PS1JIqISohFkFqwIvhQOwTgf3BcQs2BBwgzsXpC1bdBUVXE3f
