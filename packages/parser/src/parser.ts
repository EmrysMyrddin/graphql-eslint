import { convertToESTree } from "@graphql-eslint/graphql-estree";
import { parseGraphQLSDL } from "@graphql-tools/utils";
import { buildSchema, GraphQLError, GraphQLSchema, TypeInfo } from "graphql";
import { loadConfigSync, GraphQLProjectConfig } from "graphql-config";
import { loadSchemaSync } from "@graphql-tools/load";
import { GraphQLFileLoader } from "@graphql-tools/graphql-file-loader";
import { JsonFileLoader } from "@graphql-tools/json-file-loader";
import { UrlLoader } from "@graphql-tools/url-loader";
import { GraphQLESLintParseResult, ParserOptions } from "@graphql-eslint/types";

const DEFAULT_CONFIG: ParserOptions = {
  schema: null,
  skipGraphQLConfig: false,
};

export function parseForESLint(
  code: string,
  options: ParserOptions
): GraphQLESLintParseResult {
  try {
    const config = {
      ...DEFAULT_CONFIG,
      ...options,
    };

    let schema: GraphQLSchema = null;
    let configProject: GraphQLProjectConfig = null;

    if (!config.skipGraphQLConfig && options.filePath) {
      const gqlConfig = loadConfigSync({
        throwOnEmpty: false,
        throwOnMissing: false,
      });

      if (gqlConfig) {
        const projectForFile = gqlConfig.getProjectForFile(options.filePath);

        if (projectForFile) {
          configProject = projectForFile;
          schema = projectForFile.getSchemaSync();
        }
      }
    }

    if (!schema && config.schema) {
      try {
        schema = loadSchemaSync(config.schema, {
          ...config,
          assumeValidSDL: true,
          loaders: [
            {
              loaderId: () => "direct-string",
              canLoad: async () => false,
              load: async () => null,
              canLoadSync: (pointer) =>
                typeof pointer === "string" && pointer.includes("type "),
              loadSync: (pointer) => ({
                schema: buildSchema(pointer),
              }),
            },
            new GraphQLFileLoader(),
            new JsonFileLoader(),
            new UrlLoader(),
          ],
        });
      } catch (e) {
        e.message = e.message + `\nRunning from directory: ${process.cwd()}`;

        throw e;
      }
    }

    const parserServices = {
      graphqlConfigProject: configProject,
      hasTypeInfo: schema !== null,
      schema,
    };

    const graphqlAst = parseGraphQLSDL(config.filePath || "", code, {
      ...config,
      noLocation: false,
    });

    const { rootTree, comments } = convertToESTree(
      graphqlAst.document,
      schema ? new TypeInfo(schema) : null
    );

    return {
      services: parserServices,
      parserServices,
      ast: {
        type: "Program",
        body: [rootTree as any],
        sourceType: "script",
        comments,
        loc: rootTree.loc,
        range: rootTree.range as [number, number],
        tokens: [],
      },
    };
  } catch (e) {
    if (e instanceof GraphQLError) {
      const eslintError = {
        index: e.positions[0],
        lineNumber: e.locations[0].line,
        column: e.locations[0].column,
        message: e.message,
      };

      throw eslintError;
    }

    throw e;
  }
}